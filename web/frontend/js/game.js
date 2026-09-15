/*
  시선 추적 미니게임 (S-05) - 진입점. game.html 참고.

  서버 WebSocket 없이 동작한다:
      <video> 프레임 -> MediaPipe(WASM) -> 랜드마크 -> computeGaze
        -> CalibrationEngine(캘리브레이션 단계) -> GazeGameEngine(게임 단계)
      캘리브레이션이 끝나면 표본을 POST /api/calibration 으로 저장하고,
      게임이 끝나면 점수만 POST /api/game-result 한다.
*/

import { requireLogin, syncAuthWithServer } from "./auth.js";
import { createFaceLandmarker, detectLandmarks, createTimestampSource } from "./vision/faceLandmarker.js";
import { computeGaze, GazeSmoother } from "./vision/gaze.js";
import { calculateRegionGaze, createRegionPoints } from "./vision/gazeRegionClassifier.js";
import { CalibrationEngine } from "./gaze/calibrationEngine.js";
import { GazeGameEngine } from "./gaze/gameEngine.js";
import { saveCalibration } from "./gaze/calibrationApi.js";
import { showGuide } from "./guide.js";

await syncAuthWithServer();
requireLogin();

// ─────────────────────────────────────────────────────────────
// DOM
// ─────────────────────────────────────────────────────────────

const consentModal = document.getElementById("consent-modal");
const loadingModal = document.getElementById("loading-modal");
const loadingTitle = document.getElementById("loading-title");
const loadingDetail = document.getElementById("loading-detail");
const calibrationGuideModal = document.getElementById("calibration-guide-modal");
const calibrationGuideConfirm = document.getElementById("calibration-guide-confirm");
const gameGuideModal = document.getElementById("game-guide-modal");
const gameGuideConfirm = document.getElementById("game-guide-confirm");
const playScreen = document.getElementById("play-screen");
const resultScreen = document.getElementById("result-screen");
const canvas = document.getElementById("display");
const ctx = canvas.getContext("2d");
const resultScoreEl = document.getElementById("result-score");

// ─────────────────────────────────────────────────────────────
// 런타임 상태
// ─────────────────────────────────────────────────────────────

// MediaPipe 는 30fps 정도면 충분하다 (rhythm_game.js 와 동일한 근거).
const DETECT_INTERVAL_MS = 1000 / 30;

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;

let stream = null;
let landmarker = null;
let nextTimestamp = null;

let phase = null; // "calibration" | "game"
let engine = null;
let regionPoints = null; // 이번 세션에서 캘리브레이션으로 얻은 결과 (재시도 시 재사용)
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

/** 한 번만 수행하면 되는 무거운 준비(모델 로딩). */
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
// 화면 그리기 (원본 game.js 와 동일한 단순 캔버스 스타일)
// ─────────────────────────────────────────────────────────────

function resizeCanvasToWindow() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function drawBackground() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "white";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
}

function drawCalibrationState(state) {
  drawBackground();

  if (state.point) {
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(state.point[0], state.point[1], 15, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGameState(state) {
  drawBackground();

  if (state.rect) {
    const [x1, y1, x2, y2] = state.rect;
    ctx.strokeStyle = "white";
    ctx.lineWidth = 5;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  ctx.fillStyle = "white";
  ctx.font = "28px sans-serif";
  ctx.fillText(`Score: ${state.score}`, 30, 50);
  ctx.fillText(`Time: ${state.remaining.toFixed(1)}s`, canvas.width - 220, 50);
}

// ─────────────────────────────────────────────────────────────
// 검출 루프
// ─────────────────────────────────────────────────────────────

function visionLoop(now) {
  visionRafId = requestAnimationFrame(visionLoop);

  if (!engine) return;
  if (now - lastDetectAt < DETECT_INTERVAL_MS) return;
  lastDetectAt = now;

  if (video.readyState < 2) return; // 아직 프레임이 준비되지 않음

  let landmarks;
  try {
    landmarks = detectLandmarks(landmarker, video, nextTimestamp());
  } catch (err) {
    console.warn("[game] 랜드마크 검출 실패", err);
    return;
  }

  // 얼굴이 안 잡히면 그냥 건너뛴다 - 서버판 라우터들의
  // `if not result.face_landmarks: continue` 와 같은 동작.
  if (!landmarks) return;

  const state = engine.process(landmarks);

  if (phase === "calibration") {
    drawCalibrationState(state);
    if (state.finished) {
      stopVisionLoop();
      finishCalibration();
    }
  } else {
    drawGameState(state);
    if (state.finished) {
      stopVisionLoop();
      showResult(state.score);
    }
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
// 캘리브레이션 -> 게임 흐름
// ─────────────────────────────────────────────────────────────

function runCalibration() {
  resizeCanvasToWindow();
  phase = "calibration";

  engine = new CalibrationEngine(canvas.width, canvas.height, {
    computeGaze,
    smoother: new GazeSmoother(0.2),
  });

  startVisionLoop();
}

async function finishCalibration() {
  const calibration = engine.calibration;

  // js/rhythm/calibration.js(GET /api/calibration) 가 쓰는 것과 같은
  // 유도식을 여기서는 이미 메모리에 있는 표본으로 바로 계산한다 - 서버를
  // 왕복하지 않아도 되고, 다시하기(retry-btn) 때도 재사용한다.
  regionPoints = createRegionPoints(calculateRegionGaze(calibration.samples));

  try {
    await saveCalibration(calibration.width, calibration.height, calibration.samples);
  } catch (err) {
    // 저장에 실패해도 이번 플레이 자체는 메모리에 있는 표본으로 계속 진행한다 -
    // 다만 리듬게임 등 다른 화면이 쓸 캘리브레이션은 최신화되지 않은 채로
    // 남는다는 점만 콘솔에 남겨둔다.
    console.error("[game] 캘리브레이션 저장 실패", err);
  }

  await showGuide(gameGuideModal, gameGuideConfirm);

  runGame();
}

function runGame() {
  resizeCanvasToWindow();
  phase = "game";

  engine = new GazeGameEngine(canvas.width, canvas.height, regionPoints, {
    computeGaze,
    smoother: new GazeSmoother(0.2),
  });

  startVisionLoop();
}

// ─────────────────────────────────────────────────────────────
// 화면 전환
// ─────────────────────────────────────────────────────────────

function showResult(score) {
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");
  resultScoreEl.textContent = score;

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  // 서버판과 완전히 같은 엔드포인트/형식이라 마이페이지 기록도 동일하게 남는다.
  fetch("/api/game-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score, game_type: "gaze" }),
  }).catch(() => {});
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
  if (!playScreen.classList.contains("hidden") && phase === "game") resizeCanvasToWindow();
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

document.getElementById("retry-btn").addEventListener("click", () => {
  resultScreen.classList.add("hidden");
  playScreen.classList.remove("hidden");
  runGame();
});

document.getElementById("home-btn").addEventListener("click", goHome);
