/*
  시선 골키퍼(테스트 버전) - 진입점 + 게임 로직 + 캔버스 렌더링.

  두더지 사냥 프로토타입(예전 js/mole_game.js, 지금은 game.html 로 정식
  편입되며 삭제됨)과 완전히 같은 파이프라인/캘리브레이션 방식을 쓴다 -
  좌/중/우 + 깜빡임 판정은 js/rhythm/gameEngine.js 의 노트 판정 방식을
  그대로 가져왔다: 슛(공)을 '판정 대기 중인 노트' 하나로 보고, 깜빡임
  상승 엣지에서 시선 구역과 타이밍 윈도우(perfect/good)를 검사한다.
*/

import { createFaceLandmarker, detectLandmarks, createTimestampSource } from "./vision/faceLandmarker.js";
import { computeGaze, GazeSmoother } from "./vision/gaze.js";
import { BlinkMonitor } from "./vision/blinkMonitor.js";
import { CalibrationEngine } from "./gaze/calibrationEngine.js";
import { computeLaneX } from "./rhythm/calibration.js";
import { showGuide } from "./guide.js";

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const LANES = ["left", "center", "right"];
const ZONE_X_FRAC = [0.28, 0.5, 0.72]; // 골대 안에서의 좌/중/우 위치

const TOTAL_SHOTS = 8;
const TRAVEL_MS_START = 1600;
const TRAVEL_MS_STEP = 80;
const TRAVEL_MS_MIN = 950;

const PERFECT_WINDOW_MS = 150;
const GOOD_WINDOW_MS = 400;
const SCORE_PERFECT = 150;
const SCORE_GOOD = 100;
const RESULT_LINGER_MS = 900;

const DIVE_MS = 220;
const DIVE_HOLD_MS = 260;
const DIVE_RETURN_MS = 260;

const DETECT_INTERVAL_MS = 1000 / 30;

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

const hudEl = document.getElementById("hud");
const hudScoreEl = document.getElementById("hud-score");
const hudSaveEl = document.getElementById("hud-save");
const hudShotEl = document.getElementById("hud-shot");

const resultScoreEl = document.getElementById("result-score");
const resultPerfectEl = document.getElementById("result-perfect");
const resultGoodEl = document.getElementById("result-good");
const resultGoalEl = document.getElementById("result-goal");

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function closestLane(gazeX, laneX) {
  let best = LANES[0];
  let bestDist = Infinity;
  for (const lane of LANES) {
    const dist = Math.abs(gazeX - laneX[lane]);
    if (dist < bestDist) {
      bestDist = dist;
      best = lane;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────
// 이펙트(파티클/플로팅 텍스트/화면 흔들림/그물 흔들림)
// ─────────────────────────────────────────────────────────────

let particles = [];
let floatingTexts = [];
let shakeMag = 0;
let shakeUntil = 0;
let netRippleUntil = 0;
let netRippleStart = 0;

function spawnBurst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 220;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40,
      life: 400 + Math.random() * 300,
      maxLife: 700,
      color,
      size: 2.5 + Math.random() * 3.5,
    });
  }
}

function spawnFloatingText(x, y, text, color) {
  floatingTexts.push({ x, y, text, color, life: 900, maxLife: 900 });
}

function triggerShake(mag, durationMs) {
  shakeMag = mag;
  shakeUntil = performance.now() + durationMs;
}

function triggerNetRipple() {
  netRippleStart = performance.now();
  netRippleUntil = netRippleStart + 700;
}

function updateEffects(dt) {
  for (const p of particles) {
    p.life -= dt;
    p.x += (p.vx * dt) / 1000;
    p.y += (p.vy * dt) / 1000;
    p.vy += (800 * dt) / 1000;
  }
  particles = particles.filter((p) => p.life > 0);

  for (const t of floatingTexts) {
    t.life -= dt;
    t.y -= (36 * dt) / 1000;
  }
  floatingTexts = floatingTexts.filter((t) => t.life > 0);
}

function drawEffects() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const t of floatingTexts) {
    ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
    ctx.font = "bold 24px 'Pretendard', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = t.color;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 3;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

// ─────────────────────────────────────────────────────────────
// 게임 로직
// ─────────────────────────────────────────────────────────────

class GoalkeeperGame {
  constructor(laneX) {
    this.laneX = laneX;
    this.shotIndex = 0;
    this.score = 0;
    this.perfectCount = 0;
    this.goodCount = 0;
    this.goalCount = 0;
    this.finished = false;
    this.keeperDive = null; // {zoneIdx, startedAt}
    this.ball = null;
    this.startNextShot(performance.now());
  }

  travelMsForShot(index) {
    return Math.max(TRAVEL_MS_MIN, TRAVEL_MS_START - index * TRAVEL_MS_STEP);
  }

  startNextShot(now) {
    if (this.shotIndex >= TOTAL_SHOTS) {
      this.finished = true;
      this.ball = null;
      return;
    }
    const zoneIdx = Math.floor(Math.random() * 3);
    const travelMs = this.travelMsForShot(this.shotIndex);
    this.ball = {
      zoneIdx,
      zoneName: LANES[zoneIdx],
      spawnAt: now,
      travelMs,
      targetTimeMs: now + travelMs,
      judged: false,
      result: null,
      resultAt: null,
    };
    this.keeperDive = null;
  }

  tick(now, gazeX, blinkEvent) {
    if (this.finished) {
      return { finished: true, zone: null, ball: null, keeperDive: this.keeperDive, event: null };
    }

    const zone = closestLane(gazeX, this.laneX);
    const ball = this.ball;
    let event = null;

    if (ball && !ball.judged) {
      if (blinkEvent) {
        const diff = now - ball.targetTimeMs;
        if (zone === ball.zoneName && Math.abs(diff) <= GOOD_WINDOW_MS) {
          ball.judged = true;
          ball.resultAt = now;
          this.keeperDive = { zoneIdx: ball.zoneIdx, startedAt: now };

          if (Math.abs(diff) <= PERFECT_WINDOW_MS) {
            ball.result = "perfect";
            this.perfectCount += 1;
            this.score += SCORE_PERFECT;
            event = { type: "perfect" };
          } else {
            ball.result = "good";
            this.goodCount += 1;
            this.score += SCORE_GOOD;
            event = { type: "good" };
          }
        } else if (zone !== ball.zoneName) {
          // 엉뚱한 방향으로 다이빙 - 판정에는 영향 없지만 시각적으로 반응해준다
          this.keeperDive = { zoneIdx: LANES.indexOf(zone), startedAt: now };
        }
      }

      if (!ball.judged && now - ball.targetTimeMs > GOOD_WINDOW_MS) {
        ball.judged = true;
        ball.resultAt = now;
        ball.result = "goal";
        this.goalCount += 1;
        event = { type: "goal" };
      }
    }

    if (ball && ball.judged && now - ball.resultAt > RESULT_LINGER_MS) {
      this.shotIndex += 1;
      this.startNextShot(now);
    }

    return { finished: this.finished, zone, ball: this.ball, keeperDive: this.keeperDive, event };
  }
}

// ─────────────────────────────────────────────────────────────
// 렌더링
// ─────────────────────────────────────────────────────────────

function pitchGeometry(w, h) {
  return {
    goalTop: h * 0.06,
    goalLine: h * 0.32,
    postLeft: w * 0.15,
    postRight: w * 0.85,
    shooterY: h * 0.9,
  };
}

function ballPosition(ball, now, w, h) {
  const geo = pitchGeometry(w, h);
  const rawT = (now - ball.spawnAt) / ball.travelMs;

  let t;
  if (ball.judged && (ball.result === "perfect" || ball.result === "good")) {
    t = Math.min(1, (ball.resultAt - ball.spawnAt) / ball.travelMs);
  } else if (ball.judged && ball.result === "goal") {
    t = Math.min(1.3, rawT);
  } else {
    t = Math.max(0, rawT);
  }

  const clampedT = Math.min(1, t);
  const eased = clampedT * clampedT;
  const targetXFrac = ZONE_X_FRAC[ball.zoneIdx];
  const x = lerp(w * 0.5, w * targetXFrac, eased);
  const y = geo.shooterY - (geo.shooterY - geo.goalLine) * t;

  const maxR = Math.min(w, h) * 0.035;
  const minR = Math.min(w, h) * 0.01;
  let r = maxR - (maxR - minR) * clampedT;
  let alpha = 1;
  if (t > 1) alpha = Math.max(0, 1 - (t - 1) / 0.3);

  return { x, y, r, alpha };
}

function keeperXFrac(now, keeperDive) {
  if (!keeperDive) return 0.5;
  const elapsed = now - keeperDive.startedAt;
  const targetXFrac = ZONE_X_FRAC[keeperDive.zoneIdx];

  if (elapsed < DIVE_MS) {
    const t = elapsed / DIVE_MS;
    return lerp(0.5, targetXFrac, 1 - Math.pow(1 - t, 3));
  }
  if (elapsed < DIVE_MS + DIVE_HOLD_MS) {
    return targetXFrac;
  }
  if (elapsed < DIVE_MS + DIVE_HOLD_MS + DIVE_RETURN_MS) {
    const t = (elapsed - DIVE_MS - DIVE_HOLD_MS) / DIVE_RETURN_MS;
    return lerp(targetXFrac, 0.5, t);
  }
  return 0.5;
}

function drawPitch(w, h, focusZone) {
  const geo = pitchGeometry(w, h);

  // 야간 하늘 + 조명
  const sky = ctx.createLinearGradient(0, 0, 0, geo.goalTop + 40);
  sky.addColorStop(0, "#0b1a2b");
  sky.addColorStop(1, "#16324a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, geo.goalTop + 40);

  for (const fx of [0.08, 0.92]) {
    const glow = ctx.createRadialGradient(w * fx, 10, 4, w * fx, 10, w * 0.18);
    glow.addColorStop(0, "rgba(255, 233, 138, 0.55)");
    glow.addColorStop(1, "rgba(255, 233, 138, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, geo.goalTop + 60);
  }

  // 잔디
  const grass = ctx.createLinearGradient(0, geo.goalLine, 0, h);
  grass.addColorStop(0, "#1f7a3d");
  grass.addColorStop(1, "#123f20");
  ctx.fillStyle = grass;
  ctx.fillRect(0, geo.goalLine, w, h - geo.goalLine);

  // 잔디 줄무늬(원근감)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, geo.goalLine, w, h - geo.goalLine);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 2;
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.5 + i * w * 0.03, geo.goalLine);
    ctx.lineTo(w * 0.5 + i * w * 0.14, h);
    ctx.stroke();
  }
  ctx.restore();

  // 골라인
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(geo.postLeft, geo.goalLine);
  ctx.lineTo(geo.postRight, geo.goalLine);
  ctx.stroke();

  // 골대(그물)
  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.postLeft, geo.goalTop, geo.postRight - geo.postLeft, geo.goalLine - geo.goalTop);
  ctx.clip();
  ctx.fillStyle = "rgba(238, 243, 246, 0.08)";
  ctx.fillRect(geo.postLeft, geo.goalTop, geo.postRight - geo.postLeft, geo.goalLine - geo.goalTop);

  const rippleActive = performance.now() < netRippleUntil;
  const rippleT = rippleActive ? (performance.now() - netRippleStart) / 700 : 0;
  ctx.strokeStyle = "rgba(238, 243, 246, 0.4)";
  ctx.lineWidth = 1;
  const cellSize = (geo.postRight - geo.postLeft) / 16;
  for (let gx = geo.postLeft; gx <= geo.postRight; gx += cellSize) {
    const wobble = rippleActive ? Math.sin(rippleT * Math.PI * 3 + gx * 0.05) * 6 * (1 - rippleT) : 0;
    ctx.beginPath();
    ctx.moveTo(gx + wobble, geo.goalTop);
    ctx.lineTo(gx + wobble * 0.4, geo.goalLine);
    ctx.stroke();
  }
  for (let gy = geo.goalTop; gy <= geo.goalLine; gy += cellSize) {
    ctx.beginPath();
    ctx.moveTo(geo.postLeft, gy);
    ctx.lineTo(geo.postRight, gy);
    ctx.stroke();
  }
  ctx.restore();

  // 구역 스포트라이트
  const zoneIdx = LANES.indexOf(focusZone);
  if (zoneIdx !== -1) {
    const zoneWidth = (geo.postRight - geo.postLeft) / 3;
    const zx = geo.postLeft + zoneWidth * zoneIdx;
    ctx.fillStyle = "rgba(255, 244, 180, 0.12)";
    ctx.fillRect(zx, geo.goalTop, zoneWidth, h - geo.goalTop);
  }

  // 크로스바 + 골포스트
  ctx.strokeStyle = "#eef3f6";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(geo.postLeft, geo.goalTop);
  ctx.lineTo(geo.postRight, geo.goalTop);
  ctx.moveTo(geo.postLeft, geo.goalTop);
  ctx.lineTo(geo.postLeft, geo.goalLine);
  ctx.moveTo(geo.postRight, geo.goalTop);
  ctx.lineTo(geo.postRight, geo.goalLine);
  ctx.stroke();
}

function drawKeeper(now, keeperDive, w, h) {
  const geo = pitchGeometry(w, h);
  const xFrac = keeperXFrac(now, keeperDive);
  const cx = w * xFrac;
  const cy = geo.goalLine - 6;

  const isDiving = keeperDive && now - keeperDive.startedAt < DIVE_MS + DIVE_HOLD_MS;
  const lean = isDiving ? (xFrac - 0.5) * 2 : 0; // -1..1

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(lean * 0.35);

  const scale = Math.min(w, h) * 0.0022;

  // 다리
  ctx.strokeStyle = "#1a2f12";
  ctx.lineWidth = 10 * scale;
  ctx.beginPath();
  ctx.moveTo(-10 * scale, 30 * scale);
  ctx.lineTo(-14 * scale, 55 * scale);
  ctx.moveTo(10 * scale, 30 * scale);
  ctx.lineTo(14 * scale, 55 * scale);
  ctx.stroke();

  // 몸통(유니폼)
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.ellipse(0, 8 * scale, 20 * scale, 26 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // 팔(다이빙 시 뻗음)
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = 9 * scale;
  const armSpread = isDiving ? 46 : 26;
  ctx.beginPath();
  ctx.moveTo(-8 * scale, -2 * scale);
  ctx.lineTo(-armSpread * scale, isDiving ? -14 * scale : 6 * scale);
  ctx.moveTo(8 * scale, -2 * scale);
  ctx.lineTo(armSpread * scale, isDiving ? -14 * scale : 6 * scale);
  ctx.stroke();

  // 장갑
  ctx.fillStyle = "#f3f8ff";
  ctx.beginPath();
  ctx.arc(-armSpread * scale, isDiving ? -14 * scale : 6 * scale, 6 * scale, 0, Math.PI * 2);
  ctx.arc(armSpread * scale, isDiving ? -14 * scale : 6 * scale, 6 * scale, 0, Math.PI * 2);
  ctx.fill();

  // 머리
  ctx.fillStyle = "#f0c48a";
  ctx.beginPath();
  ctx.arc(0, -22 * scale, 12 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawBall(ball, now, w, h) {
  if (!ball) return;
  if (ball.judged && (ball.result === "perfect" || ball.result === "good") && now - ball.resultAt > 120) return;

  const pos = ballPosition(ball, now, w, h);
  if (pos.alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = pos.alpha;

  // 그림자
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y + pos.r * 0.9, pos.r * 0.9, pos.r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fill();

  const grad = ctx.createRadialGradient(pos.x - pos.r * 0.3, pos.y - pos.r * 0.3, pos.r * 0.2, pos.x, pos.y, pos.r);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#c9d3da");
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, pos.r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = Math.max(1, pos.r * 0.08);
  ctx.stroke();

  ctx.restore();
}

function handleEvent(event, ball, w, h) {
  if (!event || !ball) return;
  const geo = pitchGeometry(w, h);
  const x = w * ZONE_X_FRAC[ball.zoneIdx];
  const y = geo.goalLine - 10;

  if (event.type === "perfect") {
    spawnBurst(x, y, "#38e8ff", 26);
    spawnFloatingText(x, y - 10, "PERFECT SAVE!", "#38e8ff");
    triggerShake(5, 160);
  } else if (event.type === "good") {
    spawnBurst(x, y, "#4ee08a", 20);
    spawnFloatingText(x, y - 10, "GOOD SAVE", "#4ee08a");
    triggerShake(4, 140);
  } else if (event.type === "goal") {
    spawnBurst(x, geo.goalLine - 24, "#ff5c5c", 30);
    spawnFloatingText(w * 0.5, geo.goalTop + 60, "GOAL!!", "#ff5c5c");
    triggerShake(10, 260);
    triggerNetRipple();
  }
}

function drawScene(game, now, zone) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  drawPitch(w, h, zone);
  drawBall(game.ball, now, w, h);
  drawKeeper(now, game.keeperDive, w, h);
  drawEffects();
}

// ─────────────────────────────────────────────────────────────
// 준비 단계 (카메라/모델) - mole_game.js 와 동일
// ─────────────────────────────────────────────────────────────

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;

let stream = null;
let landmarker = null;
let nextTimestamp = null;

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
// 캘리브레이션 (저장하지 않고 매 플레이마다 새로 진행)
// ─────────────────────────────────────────────────────────────

let calibrationEngine = null;
let game = null;
let laneX = null;

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

async function runCalibration() {
  await showGuide(calibrationGuideModal, calibrationGuideConfirm);

  resizeCanvasToWindow();
  playScreen.classList.remove("hidden");
  // play-screen(캔버스+HUD)을 캘리브레이션과 공유하는데, HUD 는 실제 경기
  // 스코어보드라 캘리브레이션 중에는 숨긴다 - 두더지 게임과 같은 이유의 버그 수정.
  hudEl.classList.add("hidden");

  calibrationEngine = new CalibrationEngine(canvas.width, canvas.height, {
    computeGaze,
    smoother: new GazeSmoother(0.2),
  });

  startVisionLoop();
}

function finishCalibration() {
  laneX = computeLaneX(calibrationEngine.calibration.samples);
  calibrationEngine = null;
  playScreen.classList.add("hidden");
  startGame();
}

// ─────────────────────────────────────────────────────────────
// 검출 루프 (30fps 로 스로틀)
// ─────────────────────────────────────────────────────────────

let visionRafId = null;
let lastDetectAt = 0;
let currentGazeX = 0.5;
let prevIsBlinking = false;
let pendingBlink = false;
const smoother = new GazeSmoother(0.2);
let blinkMonitor = null;

function visionLoop(now) {
  visionRafId = requestAnimationFrame(visionLoop);

  if (!calibrationEngine && !game) return;
  if (now - lastDetectAt < DETECT_INTERVAL_MS) return;
  lastDetectAt = now;

  if (video.readyState < 2) return;

  let landmarks;
  try {
    landmarks = detectLandmarks(landmarker, video, nextTimestamp());
  } catch (err) {
    console.warn("[goalkeeper_game] 랜드마크 검출 실패", err);
    return;
  }
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

  const [gazeX] = computeGaze(landmarks, smoother);
  currentGazeX = gazeX;

  const blinkState = blinkMonitor.update(landmarks);
  if (blinkState.is_blinking && !prevIsBlinking) {
    pendingBlink = true;
  }
  prevIsBlinking = blinkState.is_blinking;
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
// 게임 루프 (60fps)
// ─────────────────────────────────────────────────────────────

let gameRafId = null;
let lastFrameAt = 0;

function gameLoop(now) {
  gameRafId = requestAnimationFrame(gameLoop);
  const dt = lastFrameAt ? Math.min(48, now - lastFrameAt) : 16;
  lastFrameAt = now;

  if (!game) return;

  const blinkEvent = pendingBlink;
  pendingBlink = false;

  const { finished, zone, ball, event } = game.tick(now, currentGazeX, blinkEvent);
  handleEvent(event, ball, canvas.width, canvas.height);
  updateEffects(dt);

  if (shakeMag > 0 && now < shakeUntil) {
    ctx.save();
    ctx.translate((Math.random() - 0.5) * shakeMag * 2, (Math.random() - 0.5) * shakeMag * 2);
    drawScene(game, now, zone);
    ctx.restore();
  } else {
    drawScene(game, now, zone);
  }

  hudScoreEl.textContent = game.score;
  hudSaveEl.textContent = `${game.perfectCount + game.goodCount}/${TOTAL_SHOTS}`;
  hudShotEl.textContent = `${Math.min(game.shotIndex + 1, TOTAL_SHOTS)}/${TOTAL_SHOTS}`;

  if (finished) {
    stopGameLoop();
    stopVisionLoop();
    showResult();
  }
}

function startGameLoop() {
  lastFrameAt = 0;
  if (gameRafId === null) gameRafId = requestAnimationFrame(gameLoop);
}

function stopGameLoop() {
  if (gameRafId !== null) {
    cancelAnimationFrame(gameRafId);
    gameRafId = null;
  }
}

// ─────────────────────────────────────────────────────────────
// 화면 전환
// ─────────────────────────────────────────────────────────────

async function startGame() {
  await showGuide(gameGuideModal, gameGuideConfirm);

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  playScreen.classList.remove("hidden");
  hudEl.classList.remove("hidden");

  particles = [];
  floatingTexts = [];
  shakeMag = 0;
  netRippleUntil = 0;

  blinkMonitor = new BlinkMonitor();
  prevIsBlinking = false;
  pendingBlink = false;
  game = new GoalkeeperGame(laneX);

  startGameLoop();
  startVisionLoop();
}

function showResult() {
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");

  resultScoreEl.textContent = game.score;
  resultPerfectEl.textContent = game.perfectCount;
  resultGoodEl.textContent = game.goodCount;
  resultGoalEl.textContent = game.goalCount;
}

function goHome() {
  stopVisionLoop();
  stopGameLoop();
  stopCamera();
  window.location.href = "index.html";
}

window.addEventListener("resize", () => {
  if (playScreen.classList.contains("hidden")) return;
  if (calibrationEngine) {
    resizeCanvasToWindow();
  } else {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
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
  if (!(await prepare())) return;
  await runCalibration();
});

document.getElementById("retry-btn").addEventListener("click", () => {
  resultScreen.classList.add("hidden");
  runCalibration();
});

document.getElementById("home-btn").addEventListener("click", goHome);
