/*
  리듬게임 - 서버(파이썬) 계산 백업 버전의 진입점.

  정식 버전(js/rhythm_game.js)이 브라우저에서 직접 계산하는 것과 달리,
  이 파일은 예전 방식대로 카메라 프레임을 /ws/rhythm-game 으로 보내고
  서버가 돌려주는 상태 payload 를 렌더링만 한다.

  화면 그리기는 정식 버전과 동일한 js/rhythm/renderer.js 를 공유한다 -
  상태 payload 모양이 서버판과 JS 엔진판이 같기 때문에 가능한 구조다.

  ?demo=1 로 열면 서버/웹캠/캘리브레이션 없이 가짜 상태로 디자인만 볼 수 있다.
*/

import { startFrameSender, wsUrl } from "./camera.js";
import { requireLogin, syncAuthWithServer } from "./auth.js";
import { showGuide } from "./guide.js";
import {
  LANES,
  NOTE_FALL_DURATION_MS,
  initRenderer,
  resizeCanvas,
  applyState,
  resetVisualState,
  startRenderLoop,
  stopRenderLoop,
  getMaxCombo,
  setPausedState,
} from "./rhythm/renderer.js";

/*
  데모 모드: rhythm_game_lab.html?demo=1 로 열면 서버/웹캠/캘리브레이션 없이
  가짜 상태를 만들어 비주얼만 미리 볼 수 있다. 디자인 검토용 개발 편의 기능이며,
  URL 파라미터가 없으면 코드가 전혀 실행되지 않아 실제 게임 경로에는 영향이 없다.
  (원본으로 승격시킬 때 지워도 무방한 부분 - DEMO 로 검색하면 전부 찾을 수 있음)
*/
const DEMO = new URLSearchParams(location.search).has("demo");

await syncAuthWithServer();
if (!DEMO) requireLogin();

// ─────────────────────────────────────────────────────────────
// DOM
// ─────────────────────────────────────────────────────────────

const consentModal = document.getElementById("consent-modal");
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

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;

let stream = null;
let stopSender = null;
let ws = null;
let isPaused = false;

// ─────────────────────────────────────────────────────────────
// 카메라 / WebSocket (원본과 동일)
// ─────────────────────────────────────────────────────────────

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  await video.play();
}

function stopCamera() {
  if (stopSender) stopSender();
  if (stream) stream.getTracks().forEach((track) => track.stop());
}

function sendControl(type) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type }));
  }
}

function runGame() {
  resizeCanvas();
  resetVisualState();
  isPaused = false;
  pauseModal.classList.add("hidden");
  startRenderLoop();

  ws = new WebSocket(wsUrl("/ws/rhythm-game"));

  ws.onopen = () => {
    stopSender = startFrameSender(video, ws, { fps: 15 });
  };

  ws.onmessage = (event) => {
    const state = JSON.parse(event.data);

    if (state.type === "error") {
      alert("캘리브레이션 데이터가 없습니다. 먼저 시선 추적 미니게임에서 캘리브레이션을 진행해주세요.");
      ws.close();
      goHome();
      return;
    }

    applyState(state);

    if (state.finished) {
      if (stopSender) stopSender();
      ws.close();
      showResult(state);
    }
  };

  ws.onerror = () => {
    alert("게임 서버 연결에 실패했습니다.");
  };
}

// ─────────────────────────────────────────────────────────────
// 데모 모드 (?demo=1) - 비주얼 검토 전용, 실제 게임 경로와 무관
// ─────────────────────────────────────────────────────────────

let demoTimer = null;

/**
 * rhythm_game_session.py 가 만들어 보내는 상태 payload 와 똑같은 모양의
 * 가짜 상태를 생성한다. 스폰 간격/낙하 시간/판정 윈도우도 서버 상수와 같은
 * 값을 써서 실제 게임의 템포를 그대로 재현한다.
 */
function createDemoDriver() {
  let notes = [];
  let nextId = 1;
  let nextSpawnAt = 700;
  let score = 0;
  let perfectCount = 0;
  let greatCount = 0;
  let goodCount = 0;
  let missCount = 0;
  let focus = "center";
  let nextFocusAt = 900;

  return function tick(elapsed) {
    let lastJudgment = null;

    // 시선이 이리저리 움직이는 것처럼
    if (elapsed > nextFocusAt) {
      focus = LANES[Math.floor(Math.random() * LANES.length)];
      nextFocusAt = elapsed + 500 + Math.random() * 800;
    }

    // 서버와 동일한 스폰 간격(1600~3000ms)
    if (elapsed >= nextSpawnAt) {
      notes.push({
        id: nextId++,
        lane: LANES[Math.floor(Math.random() * LANES.length)],
        spawn: elapsed,
        result: null,
        resultAt: null,
      });
      nextSpawnAt = elapsed + 1600 + Math.random() * 1400;
    }

    notes.forEach((n) => {
      if (n.result) return;
      const targetAt = n.spawn + NOTE_FALL_DURATION_MS;
      if (elapsed >= targetAt) {
        // perfect/great/good/miss 이펙트를 골고루 보여주기 위한 가중 랜덤
        const roll = Math.random();
        if (roll < 0.45) {
          n.result = "perfect";
          perfectCount += 1;
          score += 100;
        } else if (roll < 0.7) {
          n.result = "great";
          greatCount += 1;
          score += 70;
        } else if (roll < 0.85) {
          n.result = "good";
          goodCount += 1;
          score += 50;
        } else {
          n.result = "miss";
          missCount += 1;
        }
        n.resultAt = elapsed;
        lastJudgment = { lane: n.lane, result: n.result };
        focus = n.lane;
      }
    });

    // 서버의 JUDGMENT_FLASH_MS(350ms) 후 제거
    notes = notes.filter((n) => !(n.result && elapsed - n.resultAt > 350));

    const remaining = Math.max(0, 30 - elapsed / 1000);

    return {
      type: "state",
      paused: false,
      focus_lane: focus,
      notes: notes.map((n) => ({
        id: n.id,
        lane: n.lane,
        progress: Math.min(1.3, (elapsed - n.spawn) / NOTE_FALL_DURATION_MS),
        result: n.result,
      })),
      score,
      perfect_count: perfectCount,
      great_count: greatCount,
      good_count: goodCount,
      miss_count: missCount,
      last_judgment: lastJudgment,
      remaining: Math.round(remaining * 10) / 10,
      finished: remaining <= 0,
    };
  };
}

function runDemo() {
  resizeCanvas();
  resetVisualState();
  isPaused = false;
  pauseModal.classList.add("hidden");
  startRenderLoop();

  const tick = createDemoDriver();
  let elapsed = 0;

  if (demoTimer) clearInterval(demoTimer);
  demoTimer = setInterval(() => {
    if (isPaused) return;

    elapsed += 66; // 서버 프레임 간격(~15fps)과 비슷하게
    const state = tick(elapsed);
    applyState(state);

    if (state.finished) {
      clearInterval(demoTimer);
      demoTimer = null;
      showResult(state);
    }
  }, 66);
}

function stopDemo() {
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
}

function startRound() {
  if (DEMO) runDemo();
  else runGame();
}

function togglePause() {
  if (playScreen.classList.contains("hidden")) return;

  isPaused = !isPaused;

  if (isPaused) {
    sendControl("pause");
    pauseModal.classList.remove("hidden");
  } else {
    sendControl("resume");
    pauseModal.classList.add("hidden");
  }

  // 데모 모드엔 서버가 없으므로 정지 상태를 렌더러에 직접 알려준다.
  if (DEMO) setPausedState(isPaused);
}

function showResult(state) {
  stopRenderLoop();
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");

  resultScoreEl.textContent = state.score;
  if (resultComboEl) resultComboEl.textContent = getMaxCombo();
  if (resultPerfectEl) resultPerfectEl.textContent = state.perfect_count;
  if (resultGreatEl) resultGreatEl.textContent = state.great_count;
  if (resultGoodEl) resultGoodEl.textContent = state.good_count;
  if (resultMissEl) resultMissEl.textContent = state.miss_count;

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  fetch("/api/game-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: state.score, game_type: "rhythm" }),
  });
}

function goHome() {
  stopRenderLoop();
  stopDemo();
  stopCamera();
  if (ws) ws.close();
  window.location.href = "index.html";
}

// ─────────────────────────────────────────────────────────────
// 이벤트
// ─────────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
  if (!playScreen.classList.contains("hidden")) resizeCanvas();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    togglePause();
  }
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

  await showGuide(gameGuideModal, gameGuideConfirm);

  playScreen.classList.remove("hidden");
  startRound();
});

document.getElementById("resume-btn").addEventListener("click", togglePause);

document.getElementById("restart-btn").addEventListener("click", () => {
  if (stopSender) stopSender();
  if (ws) ws.close();
  stopDemo();
  pauseModal.classList.add("hidden");
  startRound();
});

document.getElementById("quit-btn").addEventListener("click", goHome);

document.getElementById("retry-btn").addEventListener("click", () => {
  resultScreen.classList.add("hidden");
  playScreen.classList.remove("hidden");
  startRound();
});

document.getElementById("home-btn").addEventListener("click", goHome);

// 데모 모드는 카메라 동의 절차가 의미 없으므로 바로 시작한다.
if (DEMO) {
  consentModal.classList.add("hidden");
  playScreen.classList.remove("hidden");
  startRound();
}
