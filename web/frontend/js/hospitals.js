import { requireLogin, syncAuthWithServer } from "./auth.js";
import { loadNaverMapsScript, fetchClinics, createClinicItem, renderMap, searchPlace } from "./nearby_clinics.js";

await syncAuthWithServer();
requireLogin();

const statusBanner = document.getElementById("status-banner");
const mapEl = document.getElementById("map");
const listEl = document.getElementById("clinic-list");
const regionSearchForm = document.getElementById("region-search-form");
const regionSearchInput = document.getElementById("region-search");

let map = null;

function setStatus(message, isError = false) {
  statusBanner.textContent = message;
  statusBanner.classList.toggle("error", isError);
}

const VISIBLE_CLINIC_COUNT = 5;

function renderClinicList(clinics) {
  listEl.innerHTML = "";

  const visibleClinics = clinics.slice(0, VISIBLE_CLINIC_COUNT);
  const restClinics = clinics.slice(VISIBLE_CLINIC_COUNT);

  visibleClinics.forEach((clinic) => listEl.appendChild(createClinicItem(clinic, () => map)));

  if (restClinics.length > 0) {
    const moreButton = document.createElement("button");
    moreButton.type = "button";
    moreButton.className = "more-button";
    moreButton.textContent = `더보기 (${restClinics.length}개 더 보기)`;
    moreButton.addEventListener("click", () => {
      moreButton.remove();
      restClinics.forEach((clinic) => listEl.appendChild(createClinicItem(clinic, () => map)));
    });
    listEl.appendChild(moreButton);
  }
}

async function loadClinics(lat, lng) {
  const data = await fetchClinics(lat, lng);

  renderClinicList(data.clinics);

  if (data.source === "mock") {
    setStatus("현재 위치 기준 예시(mock) 데이터입니다. 실제 데이터 연동 전까지 참고용으로만 사용하세요.");
  } else {
    setStatus("현재 위치 기반으로 주변 안과를 찾았습니다.");
  }

  return data.clinics;
}

async function init(lat, lng) {
  const clinics = await loadClinics(lat, lng);

  const config = await fetch("/api/config").then((res) => res.json());

  if (!config.naverMapClientId) {
    mapEl.textContent = "지도 API 키가 설정되지 않았습니다 (.env의 NAVER_MAP_CLIENT_ID). 목록은 아래에서 확인할 수 있습니다.";
    mapEl.style.display = "flex";
    mapEl.style.alignItems = "center";
    mapEl.style.justifyContent = "center";
    mapEl.style.padding = "20px";
    mapEl.style.fontSize = "13px";
    mapEl.style.color = "var(--gray)";
    return;
  }

  try {
    if (!window.naver) await loadNaverMapsScript(config.naverMapClientId);
    map = renderMap(mapEl, lat, lng, clinics);
  } catch (err) {
    mapEl.textContent = "지도를 불러오지 못했습니다.";
  }
}

function requestLocation() {
  setStatus("위치 정보를 확인하고 있습니다...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      init(position.coords.latitude, position.coords.longitude);
    },
    () => {
      setStatus(
        "위치 정보를 가져올 수 없습니다. 브라우저 설정에서 위치 권한을 허용한 뒤 다시 시도하거나, 지역 검색으로도 찾아보실 수 있습니다.",
        true
      );
    }
  );
}

regionSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = regionSearchInput.value.trim();
  if (!query) return;

  setStatus(`'${query}' 검색 중...`);

  const place = await searchPlace(query);
  if (!place) {
    setStatus(`'${query}' 검색 결과를 찾을 수 없습니다.`, true);
    return;
  }

  await init(place.lat, place.lng);
  setStatus(`'${place.name}' 위치 기준으로 주변 안과를 찾았습니다.`);
});

requestLocation();
