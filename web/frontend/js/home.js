import { startWorkerFrameCapture } from "./camera.js";
import { getAuth, isLoggedIn, logout, syncAuthWithServer, PROVIDER_LABELS } from "./auth.js";
import { loadNaverMapsScript, fetchClinics, createClinicItem, renderMap, searchPlace } from "./nearby_clinics.js";
import { createFaceLandmarker, detectLandmarks, createTimestampSource } from "./vision/faceLandmarker.js";
import { BlinkMonitor } from "./vision/blinkMonitor.js";
import { classifyEyeStatus, applyEyeStatus } from "./eyeStatus.js";

// index.html은 requireLogin()으로 리다이렉트하지 않는 유일한 페이지이지만, 구글
// 로그인은 서버 리다이렉트로 완료되므로(클라이언트가 그 시점을 알 수 없음) 로그인
// 상태를 정확히 보여주려면 여기서도 서버 세션과 동기화해야 한다.
await syncAuthWithServer();

const loginLink = document.getElementById("login-link");
const authLoggedIn = document.getElementById("auth-logged-in");
const authProviderLabel = document.getElementById("auth-provider-label");
const logoutBtn = document.getElementById("logout-btn");

const healthLoginPrompt = document.getElementById("health-login-prompt");
const healthStats = document.getElementById("health-stats");
const healthGazeScore = document.getElementById("health-gaze-score");
const healthRhythmScore = document.getElementById("health-rhythm-score");
const healthCataractRisk = document.getElementById("health-cataract-risk");
const healthRedness = document.getElementById("health-redness");
const eyeStatusText = document.getElementById("eye-status-text");
const pageRoot = document.querySelector(".page");

const NOT_MEASURED = "측정 미완료";

function formatGameScore(lastGame) {
  return lastGame ? `${lastGame.score}점` : NOT_MEASURED;
}

function formatCataractRisk(risk) {
  return risk ? `${(risk.prob * 100).toFixed(0)}% · ${risk.label}` : NOT_MEASURED;
}

function formatRedness(redness) {
  return redness ? `${(redness.ratio * 100).toFixed(0)}%` : NOT_MEASURED;
}

async function renderAuthArea() {
  if (isLoggedIn()) {
    const auth = getAuth();
    authProviderLabel.textContent = `${PROVIDER_LABELS[auth.provider] || auth.provider} 로그인됨`;
    authLoggedIn.classList.remove("hidden");
    loginLink.classList.add("hidden");

    healthLoginPrompt.classList.add("hidden");
    healthStats.classList.remove("hidden");

    const data = await fetch("/api/mypage").then((res) => res.json());
    healthGazeScore.textContent = formatGameScore(data.last_game_gaze);
    healthRhythmScore.textContent = formatGameScore(data.last_game_rhythm);
    healthCataractRisk.textContent = formatCataractRisk(data.cataract_risk);
    healthRedness.textContent = formatRedness(data.redness);
    applyEyeStatus(pageRoot, classifyEyeStatus(data.eye_status_risk), eyeStatusText);
  } else {
    authLoggedIn.classList.add("hidden");
    loginLink.classList.remove("hidden");

    healthStats.classList.add("hidden");
    healthLoginPrompt.classList.remove("hidden");
    applyEyeStatus(pageRoot, "unknown", eyeStatusText);
  }
}

logoutBtn.addEventListener("click", async () => {
  await logout();
  renderAuthArea();
});

renderAuthArea();

// 사용자 제스처(토글 클릭)로 호출되는 시점에서만 의미가 있다 - 브라우저가
// 제스처 없는 권한 요청은 막기 때문. blink/eyedrop 알림 둘 다 이걸 공유한다.
async function ensureNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
}

const toggle = document.getElementById("blink-toggle");
const statusLabel = document.getElementById("blink-status-text");
const statusEl = document.getElementById("blink-status");
const countEl = document.getElementById("blink-count");
const recentCountEl = document.getElementById("blink-recent-count");
const blinkAlertEl = document.getElementById("blink-alert");

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;

let stream = null;
let stopSender = null;

// MediaPipe 추론은 항상 메인 스레드에서 한다 (워커 경로든 폴백 경로든 공유) -
// blink_capture_worker.js 상단 주석 참고. landmarker는 페이지 세션 동안
// 한 번만 만들고 토글 on/off 사이에도 재사용한다(game.js의 prepare() 와
// 같은 캐싱 방식) - 매번 새로 만들면 WASM을 다시 컴파일해야 해서 토글할
// 때마다 수 초씩 걸린다.
let landmarker = null;
let blinkMonitor = null;
let nextTimestamp = null;

// 로컬(메인 스레드) 폴백 경로 전용 상태 - MediaStreamTrackProcessor 미지원
// 브라우저(Firefox/Safari 등)에서만 쓰인다. game.js/rhythm_game.js 와 같은
// rAF 검출 루프 패턴. 탭이 백그라운드로 가면 rAF가 스로틀링되어 검출이
// 느려지지만, 이건 워커 도입 이전부터 있던 폴백의 한계와 동일하다 - 예전
// 폴백도 메인 스레드 setInterval로 프레임을 보냈으므로 백그라운드 생존이
// 보장되지 않았다.
const LOCAL_DETECT_INTERVAL_MS = 1000 / 8;
let localRafId = null;
let localLastDetectAt = 0;

// 모니터링 시작 후 1분마다 그 구간의 깜빡임 횟수를 확인해서, 너무 적으면
// 화면에 알림을 띄운다 (blink_count는 누적값이라 직전 체크 시점과의 차이로 계산).
const BLINK_ALERT_INTERVAL_MS = 60 * 1000;
const BLINK_ALERT_THRESHOLD = 5;
const BLINK_ALERT_DISPLAY_MS = 8 * 1000;

let latestBlinkCount = 0;
let lastCheckedBlinkCount = 0;
let blinkAlertIntervalId = null;
let blinkAlertHideTimeoutId = null;

const BLINK_ALERT_TITLE = "눈 깜빡임 알림";
const BLINK_ALERT_BODY = "최근 1분간 깜빡임이 적어요. 눈을 자주 깜빡여 주세요.";

function showBlinkAlert() {
  blinkAlertEl.classList.remove("hidden");
  if (blinkAlertHideTimeoutId) clearTimeout(blinkAlertHideTimeoutId);
  blinkAlertHideTimeoutId = setTimeout(() => {
    blinkAlertEl.classList.add("hidden");
  }, BLINK_ALERT_DISPLAY_MS);

  // 다른 탭을 보고 있어도(워커 기반 모니터링은 탭이 숨겨져도 계속 동작하므로)
  // 알림을 놓치지 않도록, 권한이 있으면 OS 알림 팝업도 같이 띄운다. 페이지
  // 내부 배너는 권한 여부와 무관하게 항상 뜨므로 이 부분은 순수 보조 수단.
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(BLINK_ALERT_TITLE, { body: BLINK_ALERT_BODY, tag: "blink-alert" });
  }

  // 나중에 마이페이지에서 "위험한 습관이 있는지" 스스로 판단할 수 있도록,
  // 경고가 뜬 시각을 서버에 기록한다. index.html은 비로그인 상태에서도 접근
  // 가능해서(로그인 필수 페이지가 아님) 비로그인 사용자는 401을 받는데, 이건
  // 정상이라 조용히 무시한다.
  fetch("/api/blink-alert", { method: "POST" }).catch(() => {});
}

function hideBlinkAlert() {
  if (blinkAlertHideTimeoutId) {
    clearTimeout(blinkAlertHideTimeoutId);
    blinkAlertHideTimeoutId = null;
  }
  blinkAlertEl.classList.add("hidden");
}

function checkBlinkRate() {
  const blinksInWindow = latestBlinkCount - lastCheckedBlinkCount;
  lastCheckedBlinkCount = latestBlinkCount;

  recentCountEl.textContent = blinksInWindow;

  if (blinksInWindow <= BLINK_ALERT_THRESHOLD) {
    showBlinkAlert();
  }
}

function handleBlinkOpen() {
  statusLabel.textContent = "켜짐";
}

function handleBlinkMessage(state) {
  statusEl.textContent = state.is_blinking ? "감김" : "뜸";
  countEl.textContent = state.blink_count;
  latestBlinkCount = state.blink_count;
}

function handleBlinkClose() {
  statusLabel.textContent = "꺼짐";
}

function showModelLoadFailureAlert() {
  alert(
    "얼굴 인식 모델을 불러오지 못했습니다.\n" +
      "프로젝트 루트에서 아래를 한 번 실행했는지 확인해주세요:\n\n" +
      "    python scripts/setup_mediapipe.py"
  );
}

/** 워커가 넘겨준 ImageBitmap 한 장을 메인 스레드 MediaPipe로 처리한다. */
function handleCapturedFrame(bitmap) {
  let landmarks;
  try {
    landmarks = detectLandmarks(landmarker, bitmap, nextTimestamp());
  } catch (err) {
    console.warn("[home] 눈 깜빡임 검출 실패", err);
    bitmap.close();
    return;
  }
  bitmap.close();

  // 얼굴이 안 잡히면 건너뛴다 - 다른 WS 라우터들이
  // `if not result.face_landmarks: continue` 하던 것과 같은 동작.
  if (!landmarks) return;

  handleBlinkMessage(blinkMonitor.update(landmarks));
}

function onWorkerEvent(event) {
  if (event.type === "open") handleBlinkOpen();
  else if (event.type === "frame") handleCapturedFrame(event.bitmap);
  else if (event.type === "close") handleBlinkClose();
}

/** game.js/rhythm_game.js 와 같은 구조의 rAF 검출 루프 (워커 미지원 브라우저용). */
function localVisionLoop(now) {
  localRafId = requestAnimationFrame(localVisionLoop);

  if (now - localLastDetectAt < LOCAL_DETECT_INTERVAL_MS) return;
  localLastDetectAt = now;

  if (video.readyState < 2) return; // 아직 프레임이 준비되지 않음

  let landmarks;
  try {
    landmarks = detectLandmarks(landmarker, video, nextTimestamp());
  } catch (err) {
    console.warn("[home] 눈 깜빡임 검출 실패", err);
    return;
  }

  if (!landmarks) return;

  handleBlinkMessage(blinkMonitor.update(landmarks));
}

/** 페이지 세션당 한 번만 모델을 불러오고, 이후 토글에는 재사용한다. */
async function ensureLandmarker() {
  if (landmarker) return true;

  try {
    landmarker = await createFaceLandmarker();
  } catch (err) {
    console.error(err);
    return false;
  }

  return true;
}

async function startBlinkMonitoring() {
  await ensureNotificationPermission();

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    alert("카메라 권한이 필요합니다.");
    toggle.checked = false;
    return;
  }

  video.srcObject = stream;
  await video.play();

  if (!(await ensureLandmarker())) {
    toggle.checked = false;
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    showModelLoadFailureAlert();
    return;
  }

  blinkMonitor = new BlinkMonitor();
  nextTimestamp = createTimestampSource();

  // 탭이 hidden 상태여도 캡처가 이어지도록, 지원 브라우저에서는 워커 기반
  // 캡처를 우선 시도한다 - 미지원 브라우저(Firefox/Safari 등)는 null을 받아
  // 메인 스레드 <video> 를 직접 읽는 rAF 폴백으로 전환한다.
  stopSender = startWorkerFrameCapture(stream, { fps: 8 }, onWorkerEvent);

  if (!stopSender) {
    handleBlinkOpen();
    localLastDetectAt = 0;
    localRafId = requestAnimationFrame(localVisionLoop);

    stopSender = () => {
      if (localRafId !== null) {
        cancelAnimationFrame(localRafId);
        localRafId = null;
      }
    };
  }

  latestBlinkCount = 0;
  lastCheckedBlinkCount = 0;
  blinkAlertIntervalId = setInterval(checkBlinkRate, BLINK_ALERT_INTERVAL_MS);
}

function stopBlinkMonitoring() {
  if (stopSender) stopSender();
  stopSender = null;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  if (blinkAlertIntervalId) {
    clearInterval(blinkAlertIntervalId);
    blinkAlertIntervalId = null;
  }
  hideBlinkAlert();

  statusEl.textContent = "-";
  countEl.textContent = "0";
  recentCountEl.textContent = "-";
  statusLabel.textContent = "꺼짐";
}

toggle.addEventListener("change", () => {
  if (toggle.checked) {
    startBlinkMonitoring();
  } else {
    stopBlinkMonitoring();
  }
});

// 안약 알림 타이머 - 카메라/서버 없이 순수 클라이언트 setInterval로 동작하며,
// 알림 형태(배너 + OS 알림)는 눈 깜빡임 알림과 동일한 패턴을 그대로 따른다.
// 토글을 켜면 설정 영역만 나타나고, 실제 타이머는 "시작" 버튼을 눌러야 도는다 -
// 자동으로 시작되면 사용자가 실제로 타이머가 도는 중인지 인지하기 어렵다는
// 피드백에 따라 명시적인 시작/중지 버튼을 둔다.
const eyedropToggle = document.getElementById("eyedrop-toggle");
const eyedropSettings = document.getElementById("eyedrop-settings");
const eyedropIntervalInput = document.getElementById("eyedrop-interval");
const eyedropStartBtn = document.getElementById("eyedrop-start-btn");
const eyedropDescription = document.getElementById("eyedrop-description");
const eyedropAlertEl = document.getElementById("eyedrop-alert");

const EYEDROP_ALERT_TITLE = "안약 알림";
const EYEDROP_ALERT_BODY = "안약 넣을 시간이에요!";
const EYEDROP_ALERT_DISPLAY_MS = 8 * 1000;
const EYEDROP_MIN_MINUTES = 1;

let eyedropIntervalId = null;
let eyedropAlertHideTimeoutId = null;

function showEyedropAlert() {
  eyedropAlertEl.classList.remove("hidden");
  if (eyedropAlertHideTimeoutId) clearTimeout(eyedropAlertHideTimeoutId);
  eyedropAlertHideTimeoutId = setTimeout(() => {
    eyedropAlertEl.classList.add("hidden");
  }, EYEDROP_ALERT_DISPLAY_MS);

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(EYEDROP_ALERT_TITLE, { body: EYEDROP_ALERT_BODY, tag: "eyedrop-alert" });
  }
}

function hideEyedropAlert() {
  if (eyedropAlertHideTimeoutId) {
    clearTimeout(eyedropAlertHideTimeoutId);
    eyedropAlertHideTimeoutId = null;
  }
  eyedropAlertEl.classList.add("hidden");
}

function getEyedropMinutes() {
  const minutes = parseInt(eyedropIntervalInput.value, 10);
  return Number.isFinite(minutes) && minutes >= EYEDROP_MIN_MINUTES ? minutes : EYEDROP_MIN_MINUTES;
}

function updateEyedropDescription() {
  if (eyedropIntervalId) {
    eyedropDescription.textContent = `${getEyedropMinutes()}분마다 알림 · 실행 중`;
  } else if (eyedropToggle.checked) {
    eyedropDescription.textContent = "시작 버튼을 눌러주세요";
  } else {
    eyedropDescription.textContent = "꺼짐";
  }
}

async function startEyedropTimer() {
  await ensureNotificationPermission();

  const minutes = getEyedropMinutes();
  eyedropIntervalInput.value = minutes;

  if (eyedropIntervalId) clearInterval(eyedropIntervalId);
  eyedropIntervalId = setInterval(showEyedropAlert, minutes * 60 * 1000);

  eyedropStartBtn.textContent = "중지";
  updateEyedropDescription();
}

function stopEyedropTimer() {
  if (eyedropIntervalId) {
    clearInterval(eyedropIntervalId);
    eyedropIntervalId = null;
  }
  hideEyedropAlert();
  eyedropStartBtn.textContent = "시작";
  updateEyedropDescription();
}

eyedropToggle.addEventListener("change", () => {
  if (eyedropToggle.checked) {
    eyedropSettings.classList.remove("hidden");
    updateEyedropDescription();
  } else {
    eyedropSettings.classList.add("hidden");
    stopEyedropTimer();
  }
});

eyedropStartBtn.addEventListener("click", () => {
  if (eyedropIntervalId) {
    stopEyedropTimer();
  } else {
    startEyedropTimer();
  }
});

// 실행 중일 때 주기를 바꾸면 새 값으로 바로 다시 시작한다 (시작 버튼을
// 다시 누를 필요 없음). 아직 시작 전이면 값만 바뀌고 시작 버튼을 눌러야 돈다.
eyedropIntervalInput.addEventListener("change", () => {
  if (eyedropIntervalId) startEyedropTimer();
});

const homeMapEl = document.getElementById("home-map");
const homeMapMessage = document.getElementById("home-map-message");
const homeMapMessageText = document.getElementById("home-map-message-text");
const homeMapDesc = document.getElementById("home-map-desc");
const homeClinicList = document.getElementById("home-clinic-list");
const homeLocateBtn = document.getElementById("home-locate-btn");

const HOME_VISIBLE_CLINIC_COUNT = 5;
let homeMap = null;

async function loadHomeClinics(lat, lng) {
  const data = await fetchClinics(lat, lng);

  homeClinicList.innerHTML = "";
  data.clinics
    .slice(0, HOME_VISIBLE_CLINIC_COUNT)
    .forEach((clinic) => homeClinicList.appendChild(createClinicItem(clinic, () => homeMap)));

  return data.clinics;
}

async function initHomeMap(lat, lng) {
  homeMapDesc.textContent = "현재 위치를 기준으로 가까운 안과를 표시하고 있어요.";

  const clinics = await loadHomeClinics(lat, lng);
  const config = await fetch("/api/config").then((res) => res.json());

  if (!config.naverMapClientId) {
    homeMapMessageText.textContent = "지도 API 키가 설정되지 않았습니다. 목록은 아래에서 확인하세요.";
    return;
  }

  try {
    if (!window.naver) await loadNaverMapsScript(config.naverMapClientId);
    homeMapMessage.remove();
    homeMap = renderMap(homeMapEl, lat, lng, clinics);
  } catch (err) {
    homeMapMessageText.textContent = "지도를 불러오지 못했습니다.";
  }
}

async function searchAndShowClinics(query) {
  if (!query) return;

  homeMapDesc.textContent = `'${query}' 검색 중...`;

  const place = await searchPlace(query);
  if (!place) {
    homeMapDesc.textContent = `'${query}' 검색 결과를 찾을 수 없습니다.`;
    return;
  }

  await initHomeMap(place.lat, place.lng);
  homeMapDesc.textContent = `'${place.name}' 위치 기준으로 주변 안과를 표시하고 있어요.`;
  homeMapEl.scrollIntoView({ behavior: "smooth", block: "center" });
}

const headerSearchForm = document.getElementById("header-search-form");
const headerSearchInput = document.getElementById("header-search-input");
const mapSearchForm = document.getElementById("map-search-form");
const mapSearchInput = document.getElementById("map-search-input");

headerSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchAndShowClinics(headerSearchInput.value.trim());
});

mapSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchAndShowClinics(mapSearchInput.value.trim());
});

const quickFab = document.getElementById("quick-fab");
const quickMenu = document.getElementById("quick-menu");

quickFab.addEventListener("click", () => {
  quickMenu.classList.toggle("show");
});

homeLocateBtn.addEventListener("click", () => {
  homeMapMessageText.textContent = "위치 정보를 확인하고 있어요...";

  navigator.geolocation.getCurrentPosition(
    (position) => initHomeMap(position.coords.latitude, position.coords.longitude),
    () => {
      homeMapMessageText.textContent = "위치 정보를 사용할 수 없습니다. 안과 찾기 페이지에서 다시 시도해주세요.";
    }
  );
});
