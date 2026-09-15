/*
  테스트용 미니게임 (리듬 게임) - 진입점.

  서버 WebSocket 없이 동작한다:
      <video> 프레임 -> MediaPipe(WASM) -> 랜드마크
        -> computeGaze / BlinkMonitor -> RhythmGameEngine(판정/점수)
        -> renderer(화면)
      게임이 끝나면 최종 점수만 POST /api/game-result

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

import { requireLogin, syncAuthWithServer } from "./auth.js";
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
import { RhythmGameEngine } from "./rhythm/gameEngine.js";
import { fetchLaneX } from "./rhythm/calibration.js";
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

let engine = null;
let laneX = null;
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

/** 한 번만 수행하면 되는 무거운 준비(모델 로딩 + 캘리브레이션 조회). */
async function prepare() {
  if (!laneX) {
    showLoading("캘리브레이션 확인 중", "저장된 시선 보정 데이터를 불러옵니다.");

    laneX = await fetchLaneX();

    if (!laneX) {
      hideLoading();
      alert("캘리브레이션 데이터가 없습니다. 먼저 시선 추적 미니게임에서 캘리브레이션을 진행해주세요.");
      goHome();
      return false;
    }
  }

  if (!landmarker) {
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
  }

  hideLoading();
  return true;
}

// ─────────────────────────────────────────────────────────────
// 게임 루프
// ─────────────────────────────────────────────────────────────

function visionLoop(now) {
  visionRafId = requestAnimationFrame(visionLoop);

  if (!engine || isPaused) return;
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

  const state = engine.process(landmarks);
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

function runGame() {
  resizeCanvas();
  resetVisualState();
  isPaused = false;
  pauseModal.classList.add("hidden");

  engine = new RhythmGameEngine(laneX, {
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
  if (!engine) return;

  isPaused = !isPaused;

  if (isPaused) {
    engine.pause();
    pauseModal.classList.remove("hidden");
  } else {
    engine.resume();
    pauseModal.classList.add("hidden");
  }

  // 서버가 없으므로 정지 상태를 렌더러에 직접 알려준다(노트 보간 정지).
  setPausedState(isPaused);
}

function showResult(state) {
  stopRenderLoop();
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");

  resultScoreEl.textContent = state.score;
  resultComboEl.textContent = getMaxCombo();
  resultPerfectEl.textContent = state.perfect_count;
  resultMissEl.textContent = state.miss_count;

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  // 서버판과 완전히 같은 엔드포인트/형식이라 마이페이지 기록도 동일하게 남는다.
  fetch("/api/game-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: state.score, game_type: "rhythm" }),
  }).catch(() => {});
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
  if (!playScreen.classList.contains("hidden")) resizeCanvas();
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

  await showGuide(gameGuideModal, gameGuideConfirm);

  playScreen.classList.remove("hidden");
  runGame();
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
