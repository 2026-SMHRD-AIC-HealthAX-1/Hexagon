/*
  시선 추적 리듬게임 - 진입점.

  서버 WebSocket 없이 동작한다:
      <video> 프레임 -> MediaPipe(WASM) -> 랜드마크
        -> computeGaze / BlinkMonitor -> RhythmGameEngine(판정/점수)
        -> renderer(화면)
      게임이 끝나면 최종 점수만 POST /api/game-result

  캘리브레이션은 더 이상 독립 페이지가 아니라 이 페이지 안에서, 게임을
  시작하기 직전에 수행된다:
      - 저장된 캘리브레이션이 없으면: 안내 문구 후 곧장 캘리브레이션 진행
      - 있으면: "기존 데이터로 진행할지 / 새로 캘리브레이션할지" 선택
  캘리브레이션 화면 자체(9포인트 그리드)는 game.js 와 같은 방식으로
  js/gaze/calibrationEngine.js 를 그대로 재사용한다 - 캘리브레이션 단계는
  두 게임이 완전히 같은 계산이라 로직을 다시 만들지 않는다. 판정용
  laneX 로의 변환만 js/rhythm/calibration.js 의 computeLaneX() 를 쓴다.

  대응 관계 (서버판 -> 이 파일):
      landmarker_factory.py      -> js/vision/faceLandmarker.js
      src/gaze.py                -> js/vision/gaze.js
      src/blink_monitor.py       -> js/vision/blinkMonitor.js
      gaze_region_classifier.py  -> js/vision/gazeRegionClassifier.js
      rhythm_game_session.py     -> js/rhythm/gameEngine.js
      rhythm_game_ws.py          -> 이 파일 (프레임 루프 + 생명주기)

  두 언어가 같은 결과를 내는지는 아래 테스트로 검증한다:
      ./tests/vision_parity/run.sh    (시선/깜빡임/영역 계산)
      ./tests/rhythm_parity/run.sh    (노트 판정/점수)
*/

import { getAuth, requireLogin, syncAuthWithServer } from "./auth.js";
import {
  initRenderer,
  resizeCanvas,
  applyState,
  resetVisualState,
  startRenderLoop,
  stopRenderLoop,
  getMaxCombo,
  setPausedState,
} from "./rhythm/renderer.js";
import { createFaceLandmarker, detectLandmarks, createTimestampSource } from "./vision/faceLandmarker.js";
import { computeGaze, GazeSmoother } from "./vision/gaze.js";
import { BlinkMonitor } from "./vision/blinkMonitor.js";
import { CalibrationEngine } from "./gaze/calibrationEngine.js";
import { saveCalibration } from "./gaze/calibrationApi.js";
import { RhythmGameEngine } from "./rhythm/gameEngine.js";
import { fetchLaneX, computeLaneX } from "./rhythm/calibration.js";
import { showGuide, showChoice } from "./guide.js";
import { fetchGameRanking, renderRankingTable } from "./ranking.js";

await syncAuthWithServer();
requireLogin();

// ─────────────────────────────────────────────────────────────
// DOM
// ─────────────────────────────────────────────────────────────

const consentModal = document.getElementById("consent-modal");
const loadingModal = document.getElementById("loading-modal");
const loadingTitle = document.getElementById("loading-title");
const loadingDetail = document.getElementById("loading-detail");
const noCalibrationModal = document.getElementById("no-calibration-modal");
const noCalibrationConfirm = document.getElementById("no-calibration-confirm");
const calibrationChoiceModal = document.getElementById("calibration-choice-modal");
const calibrationChoiceReuse = document.getElementById("calibration-choice-reuse");
const calibrationChoiceRecalibrate = document.getElementById("calibration-choice-recalibrate");
const calibrationGuideModal = document.getElementById("calibration-guide-modal");
const calibrationGuideConfirm = document.getElementById("calibration-guide-confirm");
const gameGuideModal = document.getElementById("game-guide-modal");
const gameGuideConfirm = document.getElementById("game-guide-confirm");
const playScreen = document.getElementById("play-screen");
const pauseModal = document.getElementById("pause-modal");
const resultScreen = document.getElementById("result-screen");
const canvas = document.getElementById("display");
initRenderer(canvas);

const resultScoreEl = document.getElementById("result-score");
const resultComboEl = document.getElementById("result-combo");
const resultPerfectEl = document.getElementById("result-perfect");
const resultGreatEl = document.getElementById("result-great");
const resultGoodEl = document.getElementById("result-good");
const resultMissEl = document.getElementById("result-miss");

// ─────────────────────────────────────────────────────────────
// 런타임 상태
// ─────────────────────────────────────────────────────────────

// MediaPipe 는 30fps 정도면 충분하다. 화면은 렌더러가 별도 rAF 루프로
// 60fps 로 그리면서 그 사이를 보간하므로, 검출을 매 프레임 돌릴 필요가 없다.
const DETECT_INTERVAL_MS = 1000 / 30;

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;

let stream = null;
let landmarker = null;
let nextTimestamp = null;

let calibrationEngine = null; // 캘리브레이션 진행 중일 때만 설정됨
let gameEngine = null;
let laneX = null; // 캘리브레이션에서 계산해둔 결과 (재시도 시 재사용)
let isPaused = false;
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
// 캘리브레이션 화면 그리기 (game.js 와 동일한 단순 캔버스 스타일)
// ─────────────────────────────────────────────────────────────

function resizeCanvasToWindow() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function drawCalibrationState(state) {
  const ctx = canvas.getContext("2d");
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

  if (!calibrationEngine && (!gameEngine || isPaused)) return;
  if (now - lastDetectAt < DETECT_INTERVAL_MS) return;
  lastDetectAt = now;

  if (video.readyState < 2) return; // 아직 프레임이 준비되지 않음

  let landmarks;
  try {
    landmarks = detectLandmarks(landmarker, video, nextTimestamp());
  } catch (err) {
    console.warn("[rhythm_game] 랜드마크 검출 실패", err);
    return;
  }

  // 얼굴이 안 잡히면 그냥 건너뛴다. 서버판 라우터가
  // `if not result.face_landmarks: continue` 하던 것과 같은 동작.
  if (!landmarks) return;

  if (calibrationEngine) {
    const state = calibrationEngine.process(landmarks);
    drawCalibrationState(state);

    if (state.finished) {
      stopVisionLoop();
      finishCalibration();
    }
    return;
  }

  const state = gameEngine.process(landmarks);
  applyState(state);

  if (state.finished) {
    stopVisionLoop();
    showResult(state);
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

function startCalibrationEngine() {
  resizeCanvasToWindow();
  playScreen.classList.remove("hidden");

  calibrationEngine = new CalibrationEngine(canvas.width, canvas.height, {
    computeGaze,
    smoother: new GazeSmoother(0.2),
  });

  startVisionLoop();
}

async function runCalibration() {
  await showGuide(calibrationGuideModal, calibrationGuideConfirm);
  startCalibrationEngine();
}

async function finishCalibration() {
  const calibration = calibrationEngine.calibration;

  try {
    await saveCalibration(calibration.width, calibration.height, calibration.samples);
  } catch (err) {
    console.error("[rhythm_game] 캘리브레이션 저장 실패", err);
    alert("캘리브레이션 저장에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.");
    calibrationEngine = null;
    startCalibrationEngine();
    return;
  }

  laneX = computeLaneX(calibration.samples);
  calibrationEngine = null;
  playScreen.classList.add("hidden");

  await startGame();
}

// ─────────────────────────────────────────────────────────────
// 게임 흐름
// ─────────────────────────────────────────────────────────────

async function startGame() {
  await showGuide(gameGuideModal, gameGuideConfirm);

  playScreen.classList.remove("hidden");
  runGame();
}

function runGame() {
  resizeCanvas();
  resetVisualState();
  isPaused = false;
  pauseModal.classList.add("hidden");

  gameEngine = new RhythmGameEngine(laneX, {
    computeGaze,
    smoother: new GazeSmoother(0.2),
    blinkMonitor: new BlinkMonitor(),
  });

  startRenderLoop();
  startVisionLoop();
}

// ─────────────────────────────────────────────────────────────
// 화면 전환
// ─────────────────────────────────────────────────────────────

function togglePause() {
  if (playScreen.classList.contains("hidden")) return;
  if (!gameEngine) return;

  isPaused = !isPaused;

  if (isPaused) {
    gameEngine.pause();
    pauseModal.classList.remove("hidden");
  } else {
    gameEngine.resume();
    pauseModal.classList.add("hidden");
  }

  // 서버가 없으므로 정지 상태를 렌더러에 직접 알려준다(노트 보간 정지).
  setPausedState(isPaused);
}

async function showResult(state) {
  stopRenderLoop();
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");

  resultScoreEl.textContent = state.score;
  resultComboEl.textContent = getMaxCombo();
  resultPerfectEl.textContent = state.perfect_count;
  resultGreatEl.textContent = state.great_count;
  resultGoodEl.textContent = state.good_count;
  resultMissEl.textContent = state.miss_count;

  const rankingContainer = document.getElementById("ranking-content");
  rankingContainer.innerHTML = `<div class="history-empty">순위를 불러오는 중...</div>`;

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  // 서버판과 완전히 같은 엔드포인트/형식이라 마이페이지 기록도 동일하게 남는다.
  // 저장이 끝난 뒤에 랭킹을 불러와야 이번 판 점수가 TOP 10에 들었을 때 바로 반영된다.
  try {
    await fetch("/api/game-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: state.score, game_type: "rhythm" }),
    });
  } catch (err) {
    // 저장에 실패해도 결과 화면 자체는 그대로 보여준다(기존 동작 유지).
  }

  try {
    const records = await fetchGameRanking("rhythm");
    renderRankingTable(rankingContainer, records, { currentUserId: getAuth()?.userId });
  } catch (err) {
    rankingContainer.innerHTML = `<div class="history-empty">순위를 불러오지 못했습니다.</div>`;
  }
}

function goHome() {
  stopVisionLoop();
  stopRenderLoop();
  stopCamera();
  window.location.href = "index.html";
}

// ─────────────────────────────────────────────────────────────
// 이벤트
// ─────────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
  if (playScreen.classList.contains("hidden")) return;
  // 캘리브레이션 단계는 game.js 와 같은 단순 캔버스(DPR 미적용)를 쓰고,
  // 게임 단계는 renderer.js 의 DPR 인식 캔버스를 쓴다 - 어느 쪽이 활성인지에
  // 따라 리사이즈 방식도 갈라야 한다.
  if (calibrationEngine) {
    resizeCanvasToWindow();
  } else {
    resizeCanvas();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") togglePause();
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

  // 캘리브레이션 데이터 존재 여부에 따라 흐름이 갈린다.
  const existingLaneX = await fetchLaneX();

  if (!existingLaneX) {
    await showGuide(noCalibrationModal, noCalibrationConfirm);
    await runCalibration();
    return;
  }

  const choice = await showChoice(calibrationChoiceModal, [
    { button: calibrationChoiceReuse, value: "reuse" },
    { button: calibrationChoiceRecalibrate, value: "recalibrate" },
  ]);

  if (choice === "recalibrate") {
    await runCalibration();
    return;
  }

  laneX = existingLaneX;
  await startGame();
});

document.getElementById("resume-btn").addEventListener("click", togglePause);

document.getElementById("restart-btn").addEventListener("click", () => {
  stopVisionLoop();
  pauseModal.classList.add("hidden");
  runGame();
});

document.getElementById("quit-btn").addEventListener("click", goHome);

document.getElementById("retry-btn").addEventListener("click", () => {
  resultScreen.classList.add("hidden");
  playScreen.classList.remove("hidden");
  runGame();
});

document.getElementById("home-btn").addEventListener("click", goHome);

// ─────────────────────────────────────────────────────────────
// 시작
// ─────────────────────────────────────────────────────────────

consentModal.classList.remove("hidden");
