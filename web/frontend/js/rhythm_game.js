import { startFrameSender, wsUrl } from "./camera.js";
import { requireLogin, syncAuthWithServer } from "./auth.js";

await syncAuthWithServer();
requireLogin();

const consentModal = document.getElementById("consent-modal");
const playScreen = document.getElementById("play-screen");
const pauseModal = document.getElementById("pause-modal");
const resultScreen = document.getElementById("result-screen");
const canvas = document.getElementById("display");
const ctx = canvas.getContext("2d");
const resultScoreEl = document.getElementById("result-score");

const LANES = ["left", "center", "right"];
const LANE_COLORS = {
  left: "#5b8def",
  center: "#e0b64a",
  right: "#e0587a",
};

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;

let stream = null;
let stopSender = null;
let ws = null;
let isPaused = false;
let banner = null;

function resizeCanvasToWindow() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function laneCenterX(lane) {
  const index = LANES.indexOf(lane);
  return ((index + 0.5) / LANES.length) * canvas.width;
}

function judgmentLineY() {
  return canvas.height * 0.85;
}

function drawBackground() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawLanes(focusLane) {
  const laneWidth = canvas.width / LANES.length;

  LANES.forEach((lane, index) => {
    if (lane === focusLane) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(index * laneWidth, 0, laneWidth, canvas.height);
    }

    if (index > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(index * laneWidth, 0);
      ctx.lineTo(index * laneWidth, canvas.height);
      ctx.stroke();
    }
  });
}

function drawJudgmentLine() {
  const y = judgmentLineY();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(canvas.width, y);
  ctx.stroke();
}

function drawNotes(notes) {
  const y0 = 40;
  const y1 = judgmentLineY();
  const laneWidth = canvas.width / LANES.length;
  const notePadding = 10;
  const noteWidth = laneWidth - notePadding * 2;
  const noteHeight = 16;

  notes.forEach((note) => {
    const laneIndex = LANES.indexOf(note.lane);
    const x = laneIndex * laneWidth + notePadding;
    const y = y0 + Math.min(note.progress, 1.3) * (y1 - y0) - noteHeight / 2;

    if (note.result === "perfect") {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = LANE_COLORS[note.lane];
      ctx.lineWidth = 4;
    } else if (note.result === "miss") {
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.strokeStyle = "rgba(255,80,80,0.8)";
      ctx.lineWidth = 3;
    } else {
      ctx.fillStyle = LANE_COLORS[note.lane];
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
    }

    ctx.fillRect(x, y, noteWidth, noteHeight);
    ctx.strokeRect(x, y, noteWidth, noteHeight);
  });
}

function drawHud(state) {
  ctx.fillStyle = "white";
  ctx.font = "26px sans-serif";
  ctx.fillText(`Score: ${state.score}`, 24, 44);
  ctx.fillText(`Time: ${state.remaining.toFixed(1)}s`, canvas.width - 200, 44);
}

function drawBanner() {
  if (!banner) return;

  if (performance.now() > banner.expireAt) {
    banner = null;
    return;
  }

  ctx.fillStyle = banner.text === "Perfect" ? "#7CFC9A" : "#FF6B6B";
  ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(banner.text, canvas.width / 2, canvas.height * 0.4);
  ctx.textAlign = "left";
}

function drawState(state) {
  if (state.last_judgment) {
    banner = {
      text: state.last_judgment.result === "perfect" ? "Perfect" : "Miss",
      expireAt: performance.now() + 500,
    };
  }

  drawBackground();
  drawLanes(state.focus_lane);
  drawJudgmentLine();
  drawNotes(state.notes);
  drawHud(state);
  drawBanner();
}

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
  resizeCanvasToWindow();
  isPaused = false;
  banner = null;
  pauseModal.classList.add("hidden");

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

    drawState(state);

    if (state.finished) {
      if (stopSender) stopSender();
      ws.close();
      showResult(state.score);
    }
  };

  ws.onerror = () => {
    alert("게임 서버 연결에 실패했습니다.");
  };
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
}

function showResult(score) {
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");
  resultScoreEl.textContent = score;

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  fetch("/api/game-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score, game_type: "rhythm" }),
  });
}

function goHome() {
  stopCamera();
  if (ws) ws.close();
  window.location.href = "index.html";
}

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
  playScreen.classList.remove("hidden");
  runGame();
});

document.getElementById("resume-btn").addEventListener("click", togglePause);

document.getElementById("restart-btn").addEventListener("click", () => {
  if (stopSender) stopSender();
  if (ws) ws.close();
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
