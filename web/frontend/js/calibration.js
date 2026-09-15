/*
  캘리브레이션 진행 (독립 메뉴) - 진입점. calibration.html 참고.

  game.js 가 하던 "캘리브레이션 단계"만 따로 떼어 낸 것이다 - 9포인트를
  수집해 /api/calibration 에 저장하는 계산 로직(js/gaze/calibrationEngine.js,
  js/gaze/calibrationApi.js) 자체는 그대로 재사용한다.

  ?next= 로 넘어온 페이지가 있으면 완료 후 "계속하기" 버튼으로 그 페이지로
  바로 이동할 수 있게 하고(예: game.html, rhythm_game.html), 없으면(또는
  홈의 "캘리브레이션 진행" 메뉴로 직접 들어온 경우) "계속하기" 버튼은 숨긴다 -
  "홈으로" 버튼만으로 충분하기 때문.
*/

import { requireLogin, syncAuthWithServer } from "./auth.js";
import { createFaceLandmarker, detectLandmarks, createTimestampSource } from "./vision/faceLandmarker.js";
import { computeGaze, GazeSmoother } from "./vision/gaze.js";
import { CalibrationEngine } from "./gaze/calibrationEngine.js";
import { saveCalibration } from "./gaze/calibrationApi.js";
import { showGuide } from "./guide.js";

await syncAuthWithServer();
requireLogin();

// ─────────────────────────────────────────────────────────────
// next= 로 넘어온 이동 대상
// ─────────────────────────────────────────────────────────────

const NEXT_LABELS = {
  "game.html": "시선 추적 미니게임 시작하기",
  "rhythm_game.html": "리듬게임 시작하기",
};

const params = new URLSearchParams(location.search);
const nextPage = params.get("next") || "index.html";
const nextLabel = NEXT_LABELS[nextPage];

// ─────────────────────────────────────────────────────────────
// DOM
// ─────────────────────────────────────────────────────────────

const consentModal = document.getElementById("consent-modal");
const loadingModal = document.getElementById("loading-modal");
const loadingTitle = document.getElementById("loading-title");
const loadingDetail = document.getElementById("loading-detail");
const calibrationGuideModal = document.getElementById("calibration-guide-modal");
const calibrationGuideConfirm = document.getElementById("calibration-guide-confirm");
const playScreen = document.getElementById("play-screen");
const resultScreen = document.getElementById("result-screen");
const canvas = document.getElementById("display");
const ctx = canvas.getContext("2d");
const continueBtn = document.getElementById("continue-btn");

if (nextLabel) {
  continueBtn.textContent = nextLabel;
} else {
  continueBtn.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────────
// 런타임 상태
// ─────────────────────────────────────────────────────────────

const DETECT_INTERVAL_MS = 1000 / 30;

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;

let stream = null;
let landmarker = null;
let nextTimestamp = null;

let engine = null;
let visionRafId = null;
let lastDetectAt = 0;

// ─────────────────────────────────────────────────────────────
// 준비 단계
// ─────────────────────────────────────────────────────────────

function showLoading(title, detail) {
  loadingTitle.textContent = title;
  loadingDetail.textContent = detail;
  loadingModal.classList.remove("hidden");
}

function hideLoading() {
  loadingModal.classList.add("hidden");
}

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  await video.play();
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
}

async function prepare() {
  if (landmarker) return true;

  showLoading("얼굴 인식 모델 로딩 중", "처음 한 번만 내려받습니다 (약 40MB). 잠시만 기다려주세요.");
  try {
    landmarker = await createFaceLandmarker();
    nextTimestamp = createTimestampSource();
  } catch (err) {
    hideLoading();
    console.error(err);
    alert(
      "얼굴 인식 모델을 불러오지 못했습니다.\n" +
        "프로젝트 루트에서 아래를 한 번 실행했는지 확인해주세요:\n\n" +
        "    python scripts/setup_mediapipe.py"
    );
    goHome();
    return false;
  }

  hideLoading();
  return true;
}

// ─────────────────────────────────────────────────────────────
// 화면 그리기 (game.js 의 캘리브레이션 화면과 동일)
// ─────────────────────────────────────────────────────────────

function resizeCanvasToWindow() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function drawCalibrationState(state) {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "white";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);

  if (state.point) {
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(state.point[0], state.point[1], 15, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────
// 검출 루프
// ─────────────────────────────────────────────────────────────

function visionLoop(now) {
  visionRafId = requestAnimationFrame(visionLoop);

  if (!engine) return;
  if (now - lastDetectAt < DETECT_INTERVAL_MS) return;
  lastDetectAt = now;

  if (video.readyState < 2) return;

  let landmarks;
  try {
    landmarks = detectLandmarks(landmarker, video, nextTimestamp());
  } catch (err) {
    console.warn("[calibration] 랜드마크 검출 실패", err);
    return;
  }

  if (!landmarks) return;

  const state = engine.process(landmarks);
  drawCalibrationState(state);

  if (state.finished) {
    stopVisionLoop();
    finishCalibration();
  }
}

function startVisionLoop() {
  if (visionRafId === null) {
    lastDetectAt = 0;
    visionRafId = requestAnimationFrame(visionLoop);
  }
}

function stopVisionLoop() {
  if (visionRafId !== null) {
    cancelAnimationFrame(visionRafId);
    visionRafId = null;
  }
}

// ─────────────────────────────────────────────────────────────
// 캘리브레이션 흐름
// ─────────────────────────────────────────────────────────────

function runCalibration() {
  resizeCanvasToWindow();

  engine = new CalibrationEngine(canvas.width, canvas.height, {
    computeGaze,
    smoother: new GazeSmoother(0.2),
  });

  startVisionLoop();
}

async function finishCalibration() {
  const calibration = engine.calibration;

  try {
    await saveCalibration(calibration.width, calibration.height, calibration.samples);
  } catch (err) {
    console.error("[calibration] 캘리브레이션 저장 실패", err);
    alert("캘리브레이션 저장에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.");
    runCalibration();
    return;
  }

  stopCamera();
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");
}

function goHome() {
  stopVisionLoop();
  stopCamera();
  window.location.href = "index.html";
}

// ─────────────────────────────────────────────────────────────
// 이벤트
// ─────────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
  if (!playScreen.classList.contains("hidden")) resizeCanvasToWindow();
});

document.getElementById("consent-cancel").addEventListener("click", goHome);

document.getElementById("consent-confirm").addEventListener("click", async () => {
  try {
    await startCamera();
  } catch (err) {
    alert("카메라 권한이 필요합니다.");
    goHome();
    return;
  }

  consentModal.classList.add("hidden");

  if (!(await prepare())) return;

  await showGuide(calibrationGuideModal, calibrationGuideConfirm);

  playScreen.classList.remove("hidden");
  runCalibration();
});

continueBtn.addEventListener("click", () => {
  window.location.href = nextPage;
});

document.getElementById("retry-btn").addEventListener("click", async () => {
  resultScreen.classList.add("hidden");

  try {
    await startCamera();
  } catch (err) {
    alert("카메라 권한이 필요합니다.");
    goHome();
    return;
  }

  playScreen.classList.remove("hidden");
  runCalibration();
});

document.getElementById("home-btn").addEventListener("click", goHome);

// ─────────────────────────────────────────────────────────────
// 시작
// ─────────────────────────────────────────────────────────────

consentModal.classList.remove("hidden");
