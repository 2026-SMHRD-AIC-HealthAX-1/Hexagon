/*
  시선 추적 미니게임 (S-05, Eye Shot) - 두더지 사냥. game.html 참고.

  원래 이 파일은 3x3 영역을 일정 시간 응시하는 게임(js/gaze/gameEngine.js)의
  진입점이었다. 이번에 그 게임 로직 전체를 두더지 사냥으로 갈아끼웠다 -
  원본은 js/gaze/gameEngine.js 에 그대로 남아있고(더 이상 어디서도 import
  하지 않는 미사용 코드), 서버 계산판 백업(game_lab.html -> js/game_lab.js
  -> /ws/calibration, /ws/game)도 손대지 않았다. 둘 다 문제가 생기면
  되돌아갈 수 있는 자리로 남겨뒀다.

  전체 흐름은 예전 이 파일 그대로다:
      <video> -> MediaPipe(WASM) -> computeGaze/BlinkMonitor
        -> 좌/중/우 판정(laneX) -> MoleGame(스폰/타격 판정) -> 캔버스 렌더링
      게임이 끝나면 점수만 POST /api/game-result (game_type: "gaze" 유지)

  캘리브레이션도 예전과 동일한 패턴이다:
      - 저장된 캘리브레이션이 없으면: 안내 문구 후 곧장 캘리브레이션 진행
      - 있으면: "기존 데이터로 진행할지 / 새로 캘리브레이션할지" 선택
  캘리브레이션 화면(9포인트 그리드) 자체는 js/gaze/calibrationEngine.js 를
  그대로 쓰고, 판정용 좌/중/우 기준값으로의 변환은 리듬게임이 쓰는
  js/rhythm/calibration.js 의 fetchLaneX/computeLaneX 를 그대로 재사용한다
  (두더지 사냥도 좌/중/우 3구역 판정이라 리듬게임과 계산이 완전히 같다).
*/

import { requireLogin, syncAuthWithServer } from "./auth.js";
import { createFaceLandmarker, detectLandmarks, createTimestampSource } from "./vision/faceLandmarker.js";
import { computeGaze, GazeSmoother } from "./vision/gaze.js";
import { BlinkMonitor } from "./vision/blinkMonitor.js";
import { CalibrationEngine } from "./gaze/calibrationEngine.js";
import { saveCalibration } from "./gaze/calibrationApi.js";
import { fetchLaneX, computeLaneX } from "./rhythm/calibration.js";
import { showGuide, showChoice } from "./guide.js";

await syncAuthWithServer();
requireLogin();

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const LANES = ["left", "center", "right"];
const GRID_COLS = 3;
const GRID_ROWS = 3;
// 상단 HUD 와 겹치지 않도록 그리드 시작 위치를 아래로 미룸. 첫 행 두더지가
// 솟아올랐을 때 머리 끝이 HUD 아래에 오도록 잡은 값이다(HUD가 1.5배로
// 커진 만큼 예전 두더지 테스트 버전보다 여백을 더 뒀다).
const HEADER_MARGIN_PX = 155;

const GAME_DURATION_MS = 45000;
const MOLE_ACTIVE_MS = 1300;
const MOLE_RISE_MS = 150;
const MOLE_FALL_MS = 220;
const RESULT_LINGER_MS = 420;
const MOLE_MIN_INTERVAL_MS = 2000;
const MOLE_MAX_INTERVAL_MS = 3600;
const DECOY_PROB = 0.22;

const SCORE_HIT = 100;
const SCORE_DECOY_PENALTY = 50;
const COMBO_MILESTONE = 5;
const COMBO_BONUS = 50;

const DETECT_INTERVAL_MS = 1000 / 30;

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
const resultScreen = document.getElementById("result-screen");
const canvas = document.getElementById("display");
const ctx = canvas.getContext("2d");

const hudScoreEl = document.getElementById("hud-score");
const hudComboEl = document.getElementById("hud-combo");
const hudTimerEl = document.getElementById("hud-timer");

const resultScoreEl = document.getElementById("result-score");
const resultHitEl = document.getElementById("result-hit");
const resultDecoyEl = document.getElementById("result-decoy");
const resultComboEl = document.getElementById("result-combo");

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────

function randRange(min, max) {
  return min + Math.random() * (max - min);
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

// 화면 전체를 3x3 으로 균등하게 채우는 단순한 격자(원근/축소 없음).
function holePosition(zoneIdx, row, width, height) {
  const gridTop = HEADER_MARGIN_PX;
  const gridH = height - gridTop;
  const cellW = width / GRID_COLS;
  const cellH = gridH / GRID_ROWS;
  return {
    x: cellW * (zoneIdx + 0.5),
    y: gridTop + cellH * (row + 0.5),
    cellW,
    cellH,
    seed: zoneIdx * 3 + row, // 굴마다 흙 테두리 모양을 다르게(항상 같은 모양으로) 만들기 위한 값
  };
}

/** 같은 시드면 항상 같은 수열을 주는 난수(mulberry32) - 배경/흙 모양을 매 프레임 고정시키는 데 쓴다. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────
// 이펙트(파티클/플로팅 텍스트/화면 흔들림)
// ─────────────────────────────────────────────────────────────

let particles = [];
let floatingTexts = [];
let shakeMag = 0;
let shakeUntil = 0;

function spawnBurst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randRange(60, 220);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      life: randRange(400, 700),
      maxLife: 700,
      color,
      size: randRange(2.5, 5.5),
    });
  }
}

function spawnFloatingText(x, y, text, color) {
  floatingTexts.push({ x, y, text, color, life: 800, maxLife: 800 });
}

function triggerShake(mag, durationMs) {
  shakeMag = mag;
  shakeUntil = performance.now() + durationMs;
}

function updateEffects(dt) {
  for (const p of particles) {
    p.life -= dt;
    p.x += (p.vx * dt) / 1000;
    p.y += (p.vy * dt) / 1000;
    p.vy += (900 * dt) / 1000; // 중력
  }
  particles = particles.filter((p) => p.life > 0);

  for (const t of floatingTexts) {
    t.life -= dt;
    t.y -= (40 * dt) / 1000;
  }
  floatingTexts = floatingTexts.filter((t) => t.life > 0);
}

// 점수 변화가 더 잘 보이도록 팝업 크기를 기존(22px)의 2배로 키움.
function drawEffects() {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const t of floatingTexts) {
    const alpha = Math.max(0, t.life / t.maxLife);
    ctx.globalAlpha = alpha;
    ctx.font = "bold 44px 'Pretendard', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = t.color;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 5;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

// ─────────────────────────────────────────────────────────────
// 게임 로직
// ─────────────────────────────────────────────────────────────

class MoleGame {
  constructor(laneX) {
    this.laneX = laneX;
    this.startTime = performance.now();
    this.moles = [];
    this.nextSpawnAt = this.startTime + randRange(MOLE_MIN_INTERVAL_MS, MOLE_MAX_INTERVAL_MS);
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hitCount = 0;
    this.decoyMistakes = 0;
    this.finished = false;
  }

  // 한 구역(좌/중/우)에는 항상 두더지가 최대 1개만 있어야 하므로, 행이
  // 아니라 구역 단위로 점유 여부를 본다.
  occupiedZones(now) {
    const zones = new Set();
    for (const m of this.moles) {
      if (!m.judged || now - m.resultAt < RESULT_LINGER_MS) {
        zones.add(m.zoneIdx);
      }
    }
    return zones;
  }

  trySpawn(now) {
    if (now < this.nextSpawnAt) return;

    const occupied = this.occupiedZones(now);
    const freeZones = [0, 1, 2].filter((z) => !occupied.has(z));
    if (!freeZones.length) {
      this.nextSpawnAt = now + 200;
      return;
    }

    const zoneIdx = freeZones[Math.floor(Math.random() * freeZones.length)];
    const row = Math.floor(Math.random() * 3);
    this.moles.push({
      zoneIdx,
      zoneName: LANES[zoneIdx],
      row,
      spawnAt: now,
      isDecoy: Math.random() < DECOY_PROB,
      judged: false,
      result: null,
      resultAt: null,
      liftAtResult: 0, // 판정 시점의 높이 - 그 높이에서 이어서 내려간다
    });
    this.nextSpawnAt = now + randRange(MOLE_MIN_INTERVAL_MS, MOLE_MAX_INTERVAL_MS);
  }

  expireMoles(now) {
    for (const m of this.moles) {
      if (!m.judged && now - m.spawnAt > MOLE_ACTIVE_MS) {
        m.liftAtResult = naturalLift(m, now); // 이미 다 내려간 상태(≈0)에서 이어짐
        m.judged = true;
        m.resultAt = now;
        if (m.isDecoy) {
          m.result = "decoy-safe";
        } else {
          m.result = "miss";
          this.combo = 0;
        }
      }
    }
    this.moles = this.moles.filter((m) => !m.judged || now - m.resultAt < RESULT_LINGER_MS);
  }

  attemptCatch(now, zoneName) {
    const candidates = this.moles.filter((m) => !m.judged && m.zoneName === zoneName);
    if (!candidates.length) return null;

    candidates.sort((a, b) => a.spawnAt - b.spawnAt);
    const mole = candidates[0];
    mole.liftAtResult = naturalLift(mole, now);
    mole.judged = true;
    mole.resultAt = now;

    if (mole.isDecoy) {
      mole.result = "decoy-hit";
      this.score = Math.max(0, this.score - SCORE_DECOY_PENALTY);
      this.combo = 0;
      this.decoyMistakes += 1;
      return { type: "decoy", mole };
    }

    mole.result = "hit";
    this.score += SCORE_HIT;
    this.combo += 1;
    this.hitCount += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    if (this.combo % COMBO_MILESTONE === 0) {
      this.score += COMBO_BONUS;
      return { type: "combo", mole, combo: this.combo };
    }
    return { type: "hit", mole };
  }

  tick(now, gazeX, blinkEvent) {
    const elapsed = now - this.startTime;
    if (elapsed >= GAME_DURATION_MS) {
      this.finished = true;
      return { finished: true, zone: null, event: null };
    }

    const zone = closestLane(gazeX, this.laneX);
    this.trySpawn(now);

    let event = null;
    if (blinkEvent) {
      event = this.attemptCatch(now, zone);
    }
    this.expireMoles(now);

    return { finished: false, zone, event };
  }
}

// ─────────────────────────────────────────────────────────────
// 잔디 배경 (풀포기 수백 개라 매 프레임 그리면 무겁다 - 오프스크린 캔버스에
// 한 번만 그려두고 매 프레임 통째로 복사한다. 화면 크기가 바뀌면 다시 만든다)
// ─────────────────────────────────────────────────────────────

let bgCanvas = null;
let bgKey = "";

function drawGrassTuft(g, x, y, scale, rand) {
  const blades = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < blades; i++) {
    const baseX = x + (rand() - 0.5) * 12 * scale;
    const lean = (rand() - 0.5) * 18 * scale;
    const height = (10 + rand() * 18) * scale;
    g.strokeStyle = `hsla(${95 + rand() * 28}, 45%, ${24 + rand() * 20}%, 0.8)`;
    g.lineWidth = 1.7 * scale;
    g.beginPath();
    g.moveTo(baseX, y);
    g.quadraticCurveTo(baseX + lean * 0.35, y - height * 0.6, baseX + lean, y - height);
    g.stroke();
  }
}

function drawWeed(g, x, y, rand) {
  const height = 26 + rand() * 30;
  const lean = (rand() - 0.5) * 22;

  g.strokeStyle = "rgba(36,88,36,0.85)";
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + lean * 0.3, y - height * 0.6, x + lean, y - height);
  g.stroke();

  const leaves = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < leaves; i++) {
    const t = 0.35 + (i / leaves) * 0.5;
    const dir = rand() > 0.5 ? 1 : -1;
    g.fillStyle = `hsla(${100 + rand() * 20}, 42%, ${26 + rand() * 16}%, 0.85)`;
    g.beginPath();
    g.ellipse(x + lean * t + dir * 5, y - height * t, 8, 3, dir * 0.55, 0, Math.PI * 2);
    g.fill();
  }

  if (rand() > 0.55) {
    g.fillStyle = rand() > 0.5 ? "rgba(255,238,150,0.9)" : "rgba(248,248,244,0.85)";
    g.beginPath();
    g.arc(x + lean, y - height, 3.2, 0, Math.PI * 2);
    g.fill();
  }
}

function drawPebble(g, x, y, rand) {
  const r = 3 + rand() * 5;
  g.fillStyle = "rgba(108,108,98,0.5)";
  g.beginPath();
  g.ellipse(x, y, r * 1.4, r, rand() * Math.PI, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(226,226,214,0.3)";
  g.beginPath();
  g.ellipse(x - r * 0.35, y - r * 0.3, r * 0.5, r * 0.28, 0, 0, Math.PI * 2);
  g.fill();
}

function buildGrassBackground(w, h) {
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const g = off.getContext("2d");
  const rand = seededRandom(20260918);

  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#55a852");
  base.addColorStop(0.55, "#3f8f3f");
  base.addColorStop(1, "#27682b");
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // 잔디 깎은 자국
  const bandH = h / 9;
  g.fillStyle = "rgba(255,255,255,0.035)";
  for (let i = 0; i < 9; i += 2) {
    g.fillRect(0, i * bandH, w, bandH);
  }

  // 밝고 어두운 얼룩
  for (let i = 0; i < 46; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 60 + rand() * 180;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, rand() > 0.5 ? "rgba(140,202,110,0.2)" : "rgba(22,74,28,0.22)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  g.lineCap = "round";
  const tuftCount = Math.round((w * h) / 2600);
  for (let i = 0; i < tuftCount; i++) {
    drawGrassTuft(g, rand() * w, rand() * h, 0.9 + rand() * 0.9, rand);
  }

  const weedCount = Math.round((w * h) / 30000);
  for (let i = 0; i < weedCount; i++) {
    drawWeed(g, rand() * w, rand() * h, rand);
  }

  for (let i = 0; i < 14; i++) {
    drawPebble(g, rand() * w, rand() * h, rand);
  }

  // 가장자리 비네트
  const vig = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.22, w / 2, h * 0.5, Math.max(w, h) * 0.78);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.4)");
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  return off;
}

function grassBackground(w, h) {
  const key = `${w}x${h}`;
  if (!bgCanvas || bgKey !== key) {
    bgCanvas = buildGrassBackground(w, h);
    bgKey = key;
  }
  return bgCanvas;
}

// ─────────────────────────────────────────────────────────────
// 렌더링
// ─────────────────────────────────────────────────────────────

function drawScene(game, now, focusZone) {
  const w = canvas.width;
  const h = canvas.height;

  ctx.drawImage(grassBackground(w, h), 0, 0);

  // 구역 스포트라이트(현재 시선이 향한 구역의 세로 열 전체를 강조)
  const zoneIdx = LANES.indexOf(focusZone);
  if (zoneIdx !== -1) {
    const cellW = w / GRID_COLS;
    const left = cellW * zoneIdx;
    const grad = ctx.createLinearGradient(left, 0, left + cellW, 0);
    grad.addColorStop(0, "rgba(255,246,190,0)");
    grad.addColorStop(0.5, "rgba(255,246,190,0.17)");
    grad.addColorStop(1, "rgba(255,246,190,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(left, 0, cellW, h);
  }

  // 굴 9개 + 두더지 (위쪽 행부터 그려서 아래쪽이 자연스럽게 덮도록)
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let zone = 0; zone < GRID_COLS; zone++) {
      drawHole(holePosition(zone, row, w, h));
    }
  }

  for (let row = 0; row < GRID_ROWS; row++) {
    for (const mole of game.moles) {
      if (mole.row !== row) continue;
      drawMole(mole, now, holePosition(mole.zoneIdx, mole.row, w, h));
    }
  }

  drawEffects();
}

/** 굴 하나의 기하값. 두더지 클리핑도 같은 값을 써야 해서 따로 뽑아둔다. */
function holeMetrics(pos) {
  const rx = pos.cellW * 0.36;
  const ry = rx * 0.42;
  return {
    rx,
    ry,
    openY: pos.y + ry * 0.06, // 굴 입구(어두운 타원)의 중심
    openRx: rx * 0.72,
    openRy: ry * 0.66,
  };
}

/**
 * 흙 테두리는 완벽한 타원이 아니라 울퉁불퉁해야 파헤친 느낌이 난다.
 * 각도의 함수라 매 프레임 같은 모양이 나오고, 시드가 다르면 굴마다 모양이 다르다.
 * beginPath 를 부르지 않으므로 여러 개를 이어 붙여 evenodd 로 링을 만들 수 있다.
 */
function addWobblyEllipse(cx, cy, rx, ry, seed, amp = 1) {
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k =
      1 +
      (Math.sin(a * 3 + seed * 4.7) * 0.055 +
        Math.sin(a * 5 + seed * 2.3) * 0.032 +
        Math.sin(a * 8 + seed * 7.1) * 0.018) *
        amp;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function rimGradient(pos, m) {
  const grad = ctx.createRadialGradient(pos.x, pos.y - m.ry * 0.7, m.rx * 0.15, pos.x, pos.y + m.ry * 0.3, m.rx * 1.1);
  grad.addColorStop(0, "#e9c583");
  grad.addColorStop(0.55, "#bd8f45");
  grad.addColorStop(1, "#7d5a24");
  return grad;
}

/** 구멍 안쪽: 위(안쪽 벽)는 흙빛이 조금 남고 아래로 갈수록 깊고 어둡다. */
function openingGradient(pos, m) {
  const grad = ctx.createLinearGradient(pos.x, m.openY - m.openRy, pos.x, m.openY + m.openRy);
  grad.addColorStop(0, "#4b2f14");
  grad.addColorStop(0.35, "#22150a");
  grad.addColorStop(1, "#0d0804");
  return grad;
}

/** 테두리 위에 흩뿌려진 흙 알갱이. 구멍 안쪽으로는 들어가지 않는 반경에만 찍는다. */
function drawRimSpecks(pos, m) {
  const rand = seededRandom(1000 + pos.seed * 37);
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2;
    const rf = 0.78 + rand() * 0.18;
    const x = pos.x + Math.cos(a) * m.rx * rf;
    const y = pos.y + Math.sin(a) * m.ry * rf;
    const r = m.ry * (0.05 + rand() * 0.08);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.6, r, a, 0, Math.PI * 2);
    ctx.fillStyle = rand() > 0.5 ? "rgba(88,60,20,0.5)" : "rgba(243,211,150,0.45)";
    ctx.fill();
  }
}

function drawHole(pos) {
  const m = holeMetrics(pos);

  // 파헤쳐진 흙 자국 + 바닥 그림자
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  addWobblyEllipse(pos.x, pos.y + m.ry * 0.3, m.rx * 1.18, m.ry * 1.25, pos.seed + 3.4, 1.5);
  ctx.fillStyle = "#10360f";
  ctx.fill();
  ctx.restore();

  // 흙 테두리
  ctx.beginPath();
  addWobblyEllipse(pos.x, pos.y, m.rx, m.ry, pos.seed, 1);
  ctx.fillStyle = rimGradient(pos, m);
  ctx.fill();

  drawRimSpecks(pos, m);

  // 구멍
  ctx.beginPath();
  addWobblyEllipse(pos.x, m.openY, m.openRx, m.openRy, pos.seed + 1.3, 1.15);
  ctx.fillStyle = openingGradient(pos, m);
  ctx.fill();

  // 입구 위쪽 안쪽 벽에 닿는 빛
  ctx.save();
  ctx.beginPath();
  addWobblyEllipse(pos.x, m.openY, m.openRx, m.openRy, pos.seed + 1.3, 1.15);
  ctx.clip();
  ctx.strokeStyle = "rgba(226,178,110,0.35)";
  ctx.lineWidth = m.openRy * 0.3;
  ctx.beginPath();
  ctx.ellipse(pos.x, m.openY + m.openRy * 0.12, m.openRx * 0.95, m.openRy * 0.95, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.restore();
}

/**
 * 굴의 앞쪽(아래쪽) 흙 테두리를 두더지 위에 다시 덮어 그린다.
 * 두더지 몸통 아랫부분이 이 테두리 뒤로 사라지면서 '굴 안에서 올라온다'는
 * 느낌이 만들어진다 - 이게 없으면 몸통이 잔디 위에 그대로 얹혀 보인다.
 */
function drawHoleFrontRim(pos) {
  const m = holeMetrics(pos);

  ctx.save();
  ctx.beginPath();
  ctx.rect(pos.x - m.rx * 1.4, m.openY, m.rx * 2.8, m.ry * 2.8);
  ctx.clip();

  // drawHole 과 똑같은 시드/모양이라 배경의 테두리와 정확히 겹친다(이음매 없음).
  ctx.beginPath();
  addWobblyEllipse(pos.x, pos.y, m.rx, m.ry, pos.seed, 1);
  addWobblyEllipse(pos.x, m.openY, m.openRx, m.openRy, pos.seed + 1.3, 1.15);
  ctx.fillStyle = rimGradient(pos, m);
  ctx.fill("evenodd");

  drawRimSpecks(pos, m);
  ctx.restore();
}

/** 두더지 몸통 크기. 굴 입구 폭과 거의 같게 맞춰 입구에 딱 들어차게 한다. */
function moleMetrics(pos) {
  const halfW = pos.cellW * 0.26;
  // 위쪽 행의 굴을 가리지 않도록 셀 높이로 한 번 더 제한한다.
  const bodyH = Math.min(halfW * 3.0, pos.cellH * 0.78);
  return { halfW, bodyH };
}

/** 아직 판정되지 않은 두더지가 스스로 올라왔다 내려가는 높이(0~1). */
function naturalLift(mole, now) {
  const p = (now - mole.spawnAt) / MOLE_ACTIVE_MS;
  const riseFrac = MOLE_RISE_MS / MOLE_ACTIVE_MS;
  const fallFrac = MOLE_FALL_MS / MOLE_ACTIVE_MS;

  if (p <= 0) return 0;
  if (p < riseFrac) {
    const t = p / riseFrac;
    return 1 - Math.pow(1 - t, 3); // 튀어나올 때는 빠르게 솟았다 부드럽게 멈춤
  }
  if (p > 1 - fallFrac) {
    const remaining = Math.max(0, (1 - p) / fallFrac);
    return 1 - Math.pow(1 - remaining, 2); // 들어갈 때는 점점 빨라지며 쑥 내려감
  }
  return 1;
}

function moleLift(mole, now) {
  if (!mole.judged) return naturalLift(mole, now);

  // 판정된 순간의 높이에서 이어서 내려간다. 여기서 1부터 다시 시작하면
  // 시간이 다 되어 이미 내려간 두더지가 한 번 더 솟았다 내려가면서
  // 버벅이는 것처럼 보인다.
  const t = Math.min(1, (now - mole.resultAt) / RESULT_LINGER_MS);
  return mole.liftAtResult * (1 - t);
}

// 둥글둥글한 물방울/돔 모양 몸통 - 귀/볼/코 없이 눈 두 개 + 입만 있는
// 단순하고 큼직한 실루엣. 직선 벽 없이 전체를 곡선으로만 그린다.
function moleBodyPath(halfW, topY, bottomY) {
  const h = bottomY - topY;
  ctx.beginPath();
  ctx.moveTo(0, topY);
  ctx.bezierCurveTo(halfW * 0.9, topY, halfW, topY + h * 0.25, halfW, topY + h * 0.42);
  ctx.bezierCurveTo(halfW, topY + h * 0.78, halfW * 0.55, bottomY, halfW * 0.4, bottomY);
  ctx.lineTo(-halfW * 0.4, bottomY);
  ctx.bezierCurveTo(-halfW * 0.55, bottomY, -halfW, topY + h * 0.78, -halfW, topY + h * 0.42);
  ctx.bezierCurveTo(-halfW, topY + h * 0.25, -halfW * 0.9, topY, 0, topY);
  ctx.closePath();
}

/** 정상 타격 - 위로 각진 눈썹 + 질끈 감은 눈 + 찡그린 지그재그 입으로 타격감을 표현. */
function drawHitFace(halfW, eyeY, eyeDx, mouthY) {
  ctx.strokeStyle = "#2b1a0e";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 찌푸린 눈썹 - 안쪽 끝이 아래로 처지게(고통스러운 인상)
  ctx.lineWidth = halfW * 0.11;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * (eyeDx + halfW * 0.2), eyeY - halfW * 0.42);
    ctx.lineTo(side * (eyeDx - halfW * 0.16), eyeY - halfW * 0.2);
    ctx.stroke();
  }

  // 질끈 감은 눈 - 위로 볼록한 곡선(><느낌)
  ctx.lineWidth = halfW * 0.1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * eyeDx - halfW * 0.15, eyeY);
    ctx.quadraticCurveTo(side * eyeDx, eyeY - halfW * 0.22, side * eyeDx + halfW * 0.15, eyeY);
    ctx.stroke();
  }

  // 찡그린 지그재그 입
  const mouthHalf = halfW * 0.4;
  ctx.beginPath();
  ctx.moveTo(-mouthHalf, mouthY - halfW * 0.05);
  ctx.lineTo(-mouthHalf * 0.5, mouthY + halfW * 0.12);
  ctx.lineTo(0, mouthY - halfW * 0.08);
  ctx.lineTo(mouthHalf * 0.5, mouthY + halfW * 0.12);
  ctx.lineTo(mouthHalf, mouthY - halfW * 0.05);
  ctx.lineWidth = halfW * 0.1;
  ctx.stroke();
}

function drawMole(mole, now, pos) {
  const lift = moleLift(mole, now);
  if (lift <= 0.02 && !(mole.judged && mole.result === "hit")) return;

  const m = holeMetrics(pos);
  const { halfW, bodyH } = moleMetrics(pos);

  // 로컬 좌표는 몸통 '바닥'이 원점(0). lift=1 이면 바닥이 굴 입구에 걸친 채
  // 몸이 위로 솟아 있고, lift=0 이면 몸 전체가 입구 아래로 내려가 보이지 않는다.
  const topY = -bodyH;
  const bottomY = 0;
  const baseY = m.openY + m.openRy * 0.6;
  const cy = baseY + (1 - lift) * bodyH;

  ctx.save();

  // 굴 입구보다 위쪽 + 입구 타원 안쪽만 남기고 잘라낸다. 이 클리핑이 없으면
  // 몸통 아래쪽이 잔디 위로 그대로 보여서 화면 아래에서 통째로 올라오는
  // 것처럼 보인다.
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, m.openY);
  ctx.ellipse(pos.x, m.openY, m.openRx, m.openRy, 0, 0, Math.PI * 2);
  ctx.clip();

  ctx.translate(pos.x, cy);

  let squashY = 1;
  let lightColor = "#d9a75f";
  let darkColor = "#8a5a2b";
  let eyeColor = "#1a1108";
  const isHit = mole.judged && mole.result === "hit";
  if (isHit) {
    squashY = Math.max(0.15, lift);
    lightColor = "#ffe9a8";
    darkColor = "#e8b13a";
  } else if (mole.judged && mole.result === "decoy-hit") {
    lightColor = "#ff9d9d";
    darkColor = "#c73a3a";
  } else if (mole.isDecoy) {
    lightColor = "#7a5fa0";
    darkColor = "#3a2b52";
    eyeColor = "#ff5c5c";
  }

  ctx.scale(1, squashY);

  moleBodyPath(halfW, topY, bottomY);
  const bodyGrad = ctx.createRadialGradient(-halfW * 0.3, topY + halfW * 0.5, halfW * 0.15, 0, (topY + bottomY) / 2, halfW * 1.5);
  bodyGrad.addColorStop(0, lightColor);
  bodyGrad.addColorStop(1, darkColor);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(58,34,12,0.3)";
  ctx.lineWidth = halfW * 0.055;
  ctx.stroke();

  // 굴 안쪽으로 들어갈수록 그늘지게 - 몸이 구멍에 잠겨 있는 느낌을 준다
  moleBodyPath(halfW, topY, bottomY);
  const shadeGrad = ctx.createLinearGradient(0, topY + bodyH * 0.45, 0, bottomY);
  shadeGrad.addColorStop(0, "rgba(0,0,0,0)");
  shadeGrad.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = shadeGrad;
  ctx.fill();

  // 반짝임(윤기)
  ctx.beginPath();
  ctx.ellipse(-halfW * 0.42, topY + bodyH * 0.24, halfW * 0.22, halfW * 0.14, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fill();

  const eyeY = topY + bodyH * 0.38;
  const eyeDx = halfW * 0.32;
  const eyeR = halfW * 0.15;
  const mouthY = topY + bodyH * 0.58;

  if (isHit) {
    // 정상적으로 타격당한 두더지는 찡그린 표정으로 타격감을 강조한다.
    drawHitFace(halfW, eyeY, eyeDx, mouthY);
  } else {
    // 눈
    if (mole.isDecoy) {
      drawX(-eyeDx, eyeY, eyeR);
      drawX(eyeDx, eyeY, eyeR);
    } else {
      ctx.beginPath();
      ctx.arc(-eyeDx, eyeY, eyeR, 0, Math.PI * 2);
      ctx.arc(eyeDx, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = eyeColor;
      ctx.fill();
    }

    // w자 미소
    const mouthHalf = halfW * 0.42;
    const mouthDip = halfW * 0.2;
    ctx.beginPath();
    ctx.moveTo(-mouthHalf, mouthY);
    ctx.quadraticCurveTo(-mouthHalf * 0.5, mouthY + mouthDip, 0, mouthY);
    ctx.quadraticCurveTo(mouthHalf * 0.5, mouthY + mouthDip, mouthHalf, mouthY);
    ctx.strokeStyle = "#2b1a0e";
    ctx.lineWidth = halfW * 0.1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  if (mole.isDecoy && !mole.judged) {
    // 폭탄 심지
    ctx.strokeStyle = "#e8d9b8";
    ctx.lineWidth = halfW * 0.09;
    ctx.beginPath();
    ctx.moveTo(0, topY);
    ctx.quadraticCurveTo(halfW * 0.35, topY - halfW * 0.35, halfW * 0.12, topY - halfW * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(halfW * 0.12, topY - halfW * 0.6, halfW * 0.11, 0, Math.PI * 2);
    ctx.fillStyle = "#ffcf4d";
    ctx.fill();
  }

  ctx.restore();

  // 몸통 아랫부분을 굴 앞쪽 테두리로 덮어 굴에서 나오는 것처럼 마무리한다.
  drawHoleFrontRim(pos);
}

function drawX(x, y, r) {
  ctx.save();
  ctx.strokeStyle = "#ff5c5c";
  ctx.lineWidth = r * 0.5;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
  ctx.restore();
}

function handleEvent(event, w, h) {
  if (!event) return;

  // 이펙트는 굴 중심이 아니라 솟아 있는 두더지 몸통 위치에서 터져야 한다.
  const pos = holePosition(event.mole.zoneIdx, event.mole.row, w, h);
  const x = pos.x;
  const y = pos.y - moleMetrics(pos).bodyH * 0.45;

  if (event.type === "decoy") {
    spawnBurst(x, y, "#ff5c5c", 22);
    spawnFloatingText(x, y, "-50 폭탄!", "#ff5c5c");
    triggerShake(9, 220);
  } else if (event.type === "combo") {
    spawnBurst(x, y, "#ff9d3d", 30);
    spawnFloatingText(x, y, `COMBO x${event.combo}! +150`, "#ff9d3d");
    triggerShake(7, 180);
  } else if (event.type === "hit") {
    spawnBurst(x, y, "#ffcf4d", 18);
    spawnFloatingText(x, y, "+100", "#ffcf4d");
    triggerShake(4, 120);
  }
}

// ─────────────────────────────────────────────────────────────
// 준비 단계 (카메라/모델)
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
// 캘리브레이션 (rhythm_game.js 와 완전히 같은 패턴 - fetchLaneX/computeLaneX 재사용)
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
    console.error("[game] 캘리브레이션 저장 실패", err);
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
// 검출 루프 (캘리브레이션 단계 / 게임 단계 공용, 30fps 로 스로틀)
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
    console.warn("[game] 랜드마크 검출 실패", err);
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
// 게임 루프 (60fps, 검출과 별도로 매끄럽게 그린다)
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

  const { finished, zone, event } = game.tick(now, currentGazeX, blinkEvent);
  handleEvent(event, canvas.width, canvas.height);
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
  hudComboEl.textContent = game.combo;
  hudTimerEl.textContent = Math.max(0, Math.ceil((GAME_DURATION_MS - (now - game.startTime)) / 1000));

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
// 게임 흐름
// ─────────────────────────────────────────────────────────────

async function startGame() {
  await showGuide(gameGuideModal, gameGuideConfirm);

  playScreen.classList.remove("hidden");
  runGame();
}

function runGame() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  particles = [];
  floatingTexts = [];
  shakeMag = 0;

  blinkMonitor = new BlinkMonitor();
  prevIsBlinking = false;
  pendingBlink = false;
  game = new MoleGame(laneX);

  startGameLoop();
  startVisionLoop();
}

// ─────────────────────────────────────────────────────────────
// 화면 전환
// ─────────────────────────────────────────────────────────────

function showResult() {
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");

  resultScoreEl.textContent = game.score;
  resultHitEl.textContent = game.hitCount;
  resultDecoyEl.textContent = game.decoyMistakes;
  resultComboEl.textContent = game.maxCombo;

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  // 예전 게임과 game_type 을 그대로 "gaze" 로 유지해서 마이페이지 기록이 이어진다.
  fetch("/api/game-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: game.score, game_type: "gaze" }),
  }).catch(() => {});
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
