import { startWorkerFrameCapture } from "./camera.js";
import { getAuth, isLoggedIn, logout, syncAuthWithServer } from "./auth.js";
import { ensureNickname } from "./nickname.js";
import { loadNaverMapsScript, fetchClinics, createClinicItem, renderMap, searchPlace } from "./nearby_clinics.js";
import { createFaceLandmarker, detectLandmarks, createTimestampSource } from "./vision/faceLandmarker.js";
import { BlinkMonitor } from "./vision/blinkMonitor.js";
import { FaceTracker } from "./vision/faceTracker.js";
import { classifyEyeStatus, applyEyeStatus } from "./eyeStatus.js";
import { getStoredTheme, toggleTheme } from "./theme.js";
import { initQuickPhotoMenu } from "./quickPhotoMenu.js";
import { showGuide } from "./guide.js";

// index.html은 requireLogin()으로 리다이렉트하지 않는 유일한 페이지이지만, 구글
// 로그인은 서버 리다이렉트로 완료되므로(클라이언트가 그 시점을 알 수 없음) 로그인
// 상태를 정확히 보여주려면 여기서도 서버 세션과 동기화해야 한다.
await syncAuthWithServer();
// 최초 로그인으로 막 들어온 사용자는 닉네임이 없을 수 있다 - 비로그인이거나
// 이미 닉네임이 있으면 즉시 resolve되므로 이 페이지의 평소 흐름에는 영향이 없다.
await ensureNickname();

const loginLink = document.getElementById("login-link");
const authLoggedIn = document.getElementById("auth-logged-in");
const logoutBtn = document.getElementById("logout-btn");
const themeToggleBtn = document.getElementById("theme-toggle");
const themeToggleIcon = document.getElementById("theme-toggle-icon");

const healthCardTitle = document.getElementById("health-card-title");
const healthLoginPrompt = document.getElementById("health-login-prompt");
const healthStats = document.getElementById("health-stats");
const healthGazeScore = document.getElementById("health-gaze-score");
const healthRhythmScore = document.getElementById("health-rhythm-score");
const healthCataractRisk = document.getElementById("health-cataract-risk");
const healthRedness = document.getElementById("health-redness");
const eyeStatusText = document.getElementById("eye-status-text");
const eyeIconWrap = document.getElementById("eye-icon-wrap");
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
    authLoggedIn.classList.remove("hidden");
    loginLink.classList.add("hidden");

    const nickname = getAuth()?.nickname;
    healthCardTitle.textContent = nickname ? `${nickname}님의 최근 눈 건강 요약` : "최근 눈 건강 요약";

    healthLoginPrompt.classList.add("hidden");
    healthStats.classList.remove("hidden");

    const data = await fetch("/api/mypage").then((res) => res.json());
    healthGazeScore.textContent = formatGameScore(data.last_game_gaze);
    healthRhythmScore.textContent = formatGameScore(data.last_game_rhythm);
    healthCataractRisk.textContent = formatCataractRisk(data.cataract_risk);
    healthRedness.textContent = formatRedness(data.redness);
    applyEyeStatus(pageRoot, classifyEyeStatus(data.eye_status_risk), eyeStatusText, eyeIconWrap);
  } else {
    authLoggedIn.classList.add("hidden");
    loginLink.classList.remove("hidden");

    healthCardTitle.textContent = "최근 눈 건강 요약";
    healthStats.classList.add("hidden");
    healthLoginPrompt.classList.remove("hidden");
    applyEyeStatus(pageRoot, "unknown", eyeStatusText, eyeIconWrap);
  }
}

// 측정 상태(양호/주의/위험/측정 전)와 무관하게 로그인한 모든 사용자가 눈
// 아이콘을 눌러 바로 사진 분석으로 갈 수 있다 - applyEyeStatus()가 이미
// eye-icon-wrap-clickable 클래스/속성을 항상 붙여주므로, 여기서는 클릭 시
// 이동만 하면 된다(로그아웃 상태면 이 패널 자체가 숨겨져 있어 클릭할 수 없다).
eyeIconWrap.addEventListener("click", () => {
  location.href = "analysis.html";
});

eyeIconWrap.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    location.href = "analysis.html";
  }
});

logoutBtn.addEventListener("click", async () => {
  if (!confirm("로그아웃 하시겠습니까?")) return;
  await logout();
  renderAuthArea();
});

const dryEyeChecklistBtn = document.getElementById("dry-eye-checklist-btn");
const dryEyeModal = document.getElementById("dry-eye-modal");
const dryEyeCloseBtn = document.getElementById("dry-eye-close");

function openDryEyeModal() {
  dryEyeModal.classList.remove("hidden");
}

function closeDryEyeModal() {
  dryEyeModal.classList.add("hidden");
}

dryEyeChecklistBtn.addEventListener("click", openDryEyeModal);
dryEyeChecklistBtn.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openDryEyeModal();
  }
});
dryEyeCloseBtn.addEventListener("click", closeDryEyeModal);
dryEyeModal.addEventListener("click", (event) => {
  if (event.target === dryEyeModal) closeDryEyeModal();
});

const DRY_EYE_RECOMMEND_THRESHOLD = 7;
const dryEyeChecklist = document.getElementById("dry-eye-checklist");
const dryEyeCountEl = document.getElementById("dry-eye-count");
const dryEyeRecommendEl = document.getElementById("dry-eye-recommend");

function updateDryEyeResult() {
  const checked = dryEyeChecklist.querySelectorAll(".dry-eye-symptom:checked").length;
  dryEyeCountEl.textContent = checked;
  dryEyeRecommendEl.classList.toggle("hidden", checked < DRY_EYE_RECOMMEND_THRESHOLD);
}

dryEyeChecklist.addEventListener("change", updateDryEyeResult);

// 다크모드 토글 - 헤더의 예전 "Google 로그인됨" 자리. 로그인 상태일 때만
// 보이는 #auth-logged-in 안에 있으므로 표시 여부는 renderAuthArea()가 이미
// 처리하고, 여기서는 아이콘/클릭 동작만 담당한다.
function updateThemeToggleIcon() {
  const isDark = getStoredTheme() === "dark";
  themeToggleIcon.classList.toggle("icon-sun", isDark);
  themeToggleIcon.classList.toggle("icon-moon", !isDark);
}

themeToggleBtn.addEventListener("click", () => {
  toggleTheme();
  updateThemeToggleIcon();
});

updateThemeToggleIcon();

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
const countEl = document.getElementById("blink-count");
const recentCountEl = document.getElementById("blink-recent-count");
const blinkAlertEl = document.getElementById("blink-alert");

const blinkGuideModal = document.getElementById("blink-guide-modal");
const blinkGuideConfirmBtn = document.getElementById("blink-guide-confirm");
// 가이드는 웹캠 동의(getUserMedia 권한 팝업) 직후, 실제 얼굴 추적/깜빡임 측정이
// 시작되기 전에 한 번 보여준다 - 페이지 세션 동안 토글을 껐다 켰다 반복해도
// 다시 뜨지 않게 최초 1회만 노출한다(게임 가이드 모달들과 같은 방식).
let blinkGuideShown = false;

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
let faceTracker = null;
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

  // 얼굴이 안 잡혔거나, 잡힌 얼굴이 모니터링 시작 때부터 추적 중이던 사람과
  // 다른 위치(다른 사람)면 건너뛴다 - vision/faceTracker.js 참고.
  if (!faceTracker.update(landmarks)) return;

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

  if (!faceTracker.update(landmarks)) return;

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

  if (!blinkGuideShown) {
    await showGuide(blinkGuideModal, blinkGuideConfirmBtn);
    blinkGuideShown = true;
  }

  if (!(await ensureLandmarker())) {
    toggle.checked = false;
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    showModelLoadFailureAlert();
    return;
  }

  blinkMonitor = new BlinkMonitor();
  faceTracker = new FaceTracker();
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

initQuickPhotoMenu();

homeLocateBtn.addEventListener("click", () => {
  homeMapMessageText.textContent = "위치 정보를 확인하고 있어요...";

  navigator.geolocation.getCurrentPosition(
    (position) => initHomeMap(position.coords.latitude, position.coords.longitude),
    () => {
      homeMapMessageText.textContent = "위치 정보를 사용할 수 없습니다. 안과 찾기 페이지에서 다시 시도해주세요.";
    }
  );
});
