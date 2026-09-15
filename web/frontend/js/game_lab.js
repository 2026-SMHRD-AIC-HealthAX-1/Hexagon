import { startFrameSender, wsUrl } from "./camera.js";
import { requireLogin, syncAuthWithServer } from "./auth.js";
import { showGuide } from "./guide.js";

await syncAuthWithServer();
requireLogin();

const consentModal = document.getElementById("consent-modal");
const calibrationGuideModal = document.getElementById("calibration-guide-modal");
const calibrationGuideConfirm = document.getElementById("calibration-guide-confirm");
const gameGuideModal = document.getElementById("game-guide-modal");
const gameGuideConfirm = document.getElementById("game-guide-confirm");
const playScreen = document.getElementById("play-screen");
const resultScreen = document.getElementById("result-screen");
const canvas = document.getElementById("display");
const ctx = canvas.getContext("2d");
const resultScoreEl = document.getElementById("result-score");

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;

let stream = null;
let stopSender = null;

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

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  await video.play();
}

function stopCamera() {
  if (stopSender) stopSender();
  if (stream) stream.getTracks().forEach((track) => track.stop());
}

function runCalibration() {
  resizeCanvasToWindow();

  const ws = new WebSocket(wsUrl("/ws/calibration"));

  ws.onopen = () => {
    ws.send(JSON.stringify({ width: canvas.width, height: canvas.height }));
    stopSender = startFrameSender(video, ws, { fps: 15 });
  };

  ws.onmessage = async (event) => {
    const state = JSON.parse(event.data);
    drawCalibrationState(state);

    if (state.finished) {
      if (stopSender) stopSender();
      ws.close();
      await showGuide(gameGuideModal, gameGuideConfirm);
      runGame();
    }
  };

  ws.onerror = () => {
    alert("캘리브레이션 연결에 실패했습니다.");
  };
}

function runGame() {
  resizeCanvasToWindow();

  const ws = new WebSocket(wsUrl("/ws/game"));

  ws.onopen = () => {
    ws.send(JSON.stringify({ width: canvas.width, height: canvas.height }));
    stopSender = startFrameSender(video, ws, { fps: 15 });
  };

  ws.onmessage = (event) => {
    const state = JSON.parse(event.data);

    if (state.type === "error") {
      alert("캘리브레이션 데이터가 없습니다. 다시 시도해주세요.");
      ws.close();
      goHome();
      return;
    }

    drawGameState(state);

    if (state.finished) {
      if (stopSender) stopSender();
      ws.close();
      showResult(state.score);
    }
  };
}

function showResult(score) {
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");
  resultScoreEl.textContent = score;

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  fetch("/api/game-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score, game_type: "gaze" }),
  });
}

function goHome() {
  stopCamera();
  window.location.href = "index.html";
}

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
