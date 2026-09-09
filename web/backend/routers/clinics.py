import math
import os
import time
import xml.etree.ElementTree as ET

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

HIRA_API_KEY = os.environ.get("HIRA_API_KEY", "")
NAVER_MAP_CLIENT_ID = os.environ.get("NAVER_MAP_CLIENT_ID", "")
NAVER_MAP_CLIENT_SECRET = os.environ.get("NAVER_MAP_CLIENT_SECRET", "")

# NCP Maps의 Geocoding sub-API (지도용 NAVER_MAP_CLIENT_ID와 같은 애플리케이션/계정 -
# 콘솔에서 Geocoding을 활성화하고 Client Secret만 추가로 발급받으면 됨). 주소/지역명
# 텍스트 -> WGS84 좌표 변환만 한다 (가게/기관 이름 같은 비정형 검색어는 지원 대상 밖 -
# 지역명 검색만으로 충분하다는 결정에 따라 별도의 Local Search API는 쓰지 않는다).
# 좌표를 WGS84로 바로 반환하므로 HIRA API/Naver Maps JS SDK와 같은 좌표계라 별도
# 변환이 필요 없다.
NAVER_GEOCODE_ENDPOINT = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"

# data.go.kr 국립중앙의료원 "전국 병·의원 찾기 서비스" (B552657/HsptlAsembySearchService).
# getHsptlMdcncListInfoInqire(병·의원 목록정보 조회)를 QD=D012(안과)로 필터링하면
# 응답에 좌표(wgs84Lat/wgs84Lon)까지 포함되어 있어, 별도 위치정보 조회나
# 좌표->행정구역 변환 없이 한 번의 호출로 안과 목록 + 좌표를 얻을 수 있다.
# 이 서비스는 XML만 지원한다.
HIRA_ENDPOINT = "https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire"
EYE_CLINIC_DEPT_CODE = "D012"

# 데이터 갱신주기가 1일 1회이므로, 매 요청마다 전국 안과 목록을 다시 받아오지 않고
# 서버 메모리에 캐싱해서 재사용한다.
CACHE_TTL_SECONDS = 24 * 60 * 60
_cache = {"clinics": None, "fetched_at": 0.0}

MOCK_CLINICS = [
    {"name": "서울안과의원", "offset": (0.003, 0.002)},
    {"name": "밝은눈안과", "offset": (-0.004, 0.003)},
    {"name": "연세사랑안과의원", "offset": (0.002, -0.005)},
    {"name": "누네안과병원", "offset": (-0.002, -0.002)},
    {"name": "새빛안과의원", "offset": (0.006, 0.001)},
]


def haversine_distance_m(lat1, lng1, lat2, lng2):
    earth_radius_m = 6371000

    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )

    return 2 * earth_radius_m * math.asin(math.sqrt(a))


def fetch_mock_clinics(lat, lng):
    clinics = []

    for entry in MOCK_CLINICS:
        offset_lat, offset_lng = entry["offset"]
        clinic_lat = lat + offset_lat
        clinic_lng = lng + offset_lng

        clinics.append({
            "name": entry["name"],
            "lat": clinic_lat,
            "lng": clinic_lng,
            "distance_m": round(haversine_distance_m(lat, lng, clinic_lat, clinic_lng)),
        })

    return clinics


async def fetch_all_eye_clinics_from_hira():
    all_clinics = []
    page_no = 1
    num_of_rows = 1000
    max_pages = 10

    async with httpx.AsyncClient(timeout=10.0) as client:
        while page_no <= max_pages:
            params = {
                "serviceKey": HIRA_API_KEY,
                "QD": EYE_CLINIC_DEPT_CODE,
                "pageNo": page_no,
                "numOfRows": num_of_rows,
            }

            response = await client.get(HIRA_ENDPOINT, params=params)
            response.raise_for_status()

            root = ET.fromstring(response.text)

            result_code = root.findtext("./header/resultCode")
            if result_code != "00":
                raise RuntimeError(
                    f"HIRA API error {result_code}: {root.findtext('./header/resultMsg')}"
                )

            for item in root.findall("./body/items/item"):
                try:
                    all_clinics.append({
                        "name": item.findtext("dutyName"),
                        "lat": float(item.findtext("wgs84Lat")),
                        "lng": float(item.findtext("wgs84Lon")),
                    })
                except (TypeError, ValueError):
                    continue

            total_count = int(root.findtext("./body/totalCount") or 0)

            if page_no * num_of_rows >= total_count:
                break

            page_no += 1

    return all_clinics


async def get_cached_eye_clinics():
    now = time.time()

    if _cache["clinics"] is None or (now - _cache["fetched_at"]) > CACHE_TTL_SECONDS:
        _cache["clinics"] = await fetch_all_eye_clinics_from_hira()
        _cache["fetched_at"] = now

    return _cache["clinics"]


async def fetch_hira_clinics(lat, lng):
    all_clinics = await get_cached_eye_clinics()

    clinics = []

    for clinic in all_clinics:
        clinics.append({
            "name": clinic["name"],
            "lat": clinic["lat"],
            "lng": clinic["lng"],
            "distance_m": round(haversine_distance_m(lat, lng, clinic["lat"], clinic["lng"])),
        })

    return clinics


async def search_places(query):
    if not NAVER_MAP_CLIENT_ID or not NAVER_MAP_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="장소 검색 API 키가 설정되지 않았습니다.")

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            NAVER_GEOCODE_ENDPOINT,
            params={"query": query},
            headers={
                "x-ncp-apigw-api-key-id": NAVER_MAP_CLIENT_ID,
                "x-ncp-apigw-api-key": NAVER_MAP_CLIENT_SECRET,
            },
        )
        response.raise_for_status()
        data = response.json()

    if data.get("status") != "OK":
        return []

    results = []
    for address in data.get("addresses", []):
        try:
            lat, lng = float(address["y"]), float(address["x"])
        except (KeyError, ValueError, TypeError):
            continue

        results.append({
            "name": address.get("roadAddress") or address.get("jibunAddress") or query,
            "address": address.get("roadAddress") or address.get("jibunAddress") or "",
            "lat": lat,
            "lng": lng,
        })

    return results


@router.get("/api/place-search")
async def get_place_search(query: str = Query(..., min_length=1)):
    return {"results": await search_places(query)}


@router.get("/api/clinics")
async def get_nearby_clinics(lat: float = Query(...), lng: float = Query(...)):
    source = "mock"
    clinics = None

    if HIRA_API_KEY:
        try:
            clinics = await fetch_hira_clinics(lat, lng)
            source = "hira"
        except Exception as exc:
            print(f"[clinics] HIRA API call failed, falling back to mock data: {exc!r}")
            clinics = None

    if clinics is None:
        clinics = fetch_mock_clinics(lat, lng)
        source = "mock"

    clinics.sort(key=lambda c: c["distance_m"])

    return {"clinics": clinics[:10], "source": source}
