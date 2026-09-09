// home.js와 hospitals.js가 공유하는 안과 지도/목록 렌더링 로직.

export function loadNaverMapsScript(clientId) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export async function fetchClinics(lat, lng) {
  const response = await fetch(`/api/clinics?lat=${lat}&lng=${lng}`);
  return response.json();
}

// 검색어(지역명/주소 - 가게·기관 이름은 지원하지 않음, see clinics.py) -> 좌표.
// 결과가 없거나 API 키가 없으면(503) null을 반환한다 - 호출부가 상태 메시지로 안내한다.
export async function searchPlace(query) {
  const response = await fetch(`/api/place-search?query=${encodeURIComponent(query)}`);
  if (!response.ok) return null;

  const data = await response.json();
  return data.results && data.results.length > 0 ? data.results[0] : null;
}

// getMap: () => map 형태의 getter를 받는다 - 클릭 시점에 지도가 아직 로딩 중일 수 있어서
// map 인스턴스를 값으로 바로 넘기지 않고 최신 값을 조회하도록 함.
export function createClinicItem(clinic, getMap) {
  const item = document.createElement("div");
  item.className = "clinic-item";
  item.innerHTML = `
    <span>${clinic.name}</span>
    <span class="distance">${clinic.distance_m}m</span>
  `;

  item.addEventListener("click", () => {
    const map = getMap ? getMap() : null;
    if (map) {
      map.setCenter(new naver.maps.LatLng(clinic.lat, clinic.lng));
    }
  });

  return item;
}

export function renderMap(mapEl, lat, lng, clinics) {
  const map = new naver.maps.Map(mapEl, {
    center: new naver.maps.LatLng(lat, lng),
    zoom: 15,
  });

  new naver.maps.Marker({
    position: new naver.maps.LatLng(lat, lng),
    map,
    icon: {
      content: '<div style="width:12px;height:12px;border-radius:50%;background:#1b4fbb;border:2px solid #fff;"></div>',
    },
  });

  const infoWindow = new naver.maps.InfoWindow({
    content: "",
    disableAnchor: true,
    borderWidth: 0,
    backgroundColor: "transparent",
  });

  clinics.forEach((clinic) => {
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(clinic.lat, clinic.lng),
      map,
      title: clinic.name,
    });

    naver.maps.Event.addListener(marker, "mouseover", () => {
      infoWindow.setContent(`<div class="clinic-tooltip">${clinic.name}</div>`);
      infoWindow.open(map, marker);
    });

    naver.maps.Event.addListener(marker, "mouseout", () => {
      infoWindow.close();
    });
  });

  return map;
}
