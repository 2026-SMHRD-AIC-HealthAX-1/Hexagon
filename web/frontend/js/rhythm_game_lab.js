/*
  리듬게임 비주얼 개선 테스트 버전 (lab) - 렌더러.

  ★ 게임 메커니즘은 한 줄도 바뀌지 않았다.
    원본과 동일한 /ws/rhythm-game 에 붙고, 서버가 보내는 상태 payload
    ({focus_lane, notes[{id,lane,progress,result}], score, last_judgment,
      remaining, finished, paused, perfect_count, miss_count})를 그대로 소비한다.
    시선으로 레인 선택 / 눈 깜빡임으로 히트 / 판정·점수 계산은 전부 서버 몫이라
    이 파일은 "받은 상태를 어떻게 그리는가"만 담당한다.

  원본 대비 달라진 점 (전부 렌더링 영역):
    - 평면 3레인 -> 소실점으로 모이는 3D 원근 하이웨이
    - 노트가 거리에 따라 크기/위치가 변하는 원근 투영
    - 히트 시 파티클 버스트 / 충격파 링 / 光 빔 / 화면 흔들림
    - 콤보 카운터, 판정 텍스트 애니메이션, 정확도 게이지
    - 우주 배경(별/네뷸라) + 흐르는 원근 그리드
    - 서버 15fps 상태를 60fps rAF 루프에서 보간해 부드럽게 렌더

  원본 교체 시: 이 파일을 js/rhythm_game.js 로 덮어쓰면 된다 (DOM id 동일).
*/

import { startFrameSender, wsUrl } from "./camera.js";
import { requireLogin, syncAuthWithServer } from "./auth.js";

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
const playScreen = document.getElementById("play-screen");
const pauseModal = document.getElementById("pause-modal");
const resultScreen = document.getElementById("result-screen");
const canvas = document.getElementById("display");
const ctx = canvas.getContext("2d");
const resultScoreEl = document.getElementById("result-score");
const resultComboEl = document.getElementById("result-combo");
const resultPerfectEl = document.getElementById("result-perfect");
const resultMissEl = document.getElementById("result-miss");

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const LANES = ["left", "center", "right"];

// 서버(rhythm_game_session.py)의 NOTE_FALL_DURATION_MS 와 같은 값.
// 서버 상태 수신 간격(~15fps) 사이를 60fps로 보간할 때만 쓰는 값이라
// 판정에는 전혀 관여하지 않는다. 서버 값이 바뀌면 여기도 맞춰줄 것.
const NOTE_FALL_DURATION_MS = 3000;

const LANE_COLORS = {
  left: [56, 232, 255],   // cyan
  center: [176, 108, 255], // violet
  right: [255, 47, 208],  // magenta
};

const COLOR_PERFECT = [130, 255, 246];
const COLOR_MISS = [255, 77, 106];

// 원근 강도: 소실점 쪽 폭이 판정선 쪽 폭의 몇 배인지
const FAR_SCALE = 0.26;
const PERSPECTIVE_K = 1 / FAR_SCALE - 1;

const FONT_HUD = 'Orbitron, "Pretendard", system-ui, sans-serif';

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

let viewW = 0;
let viewH = 0;
let rafId = null;

// 서버에서 받은 최신 상태 + 받은 시각(보간용)
let serverState = null;
let serverStateAt = 0;

// 시각 효과 상태
let stars = [];
let nebulas = [];
let backdropSprite = null;
let particles = [];
let shockwaves = [];
let beams = [];
let noteFx = new Map(); // note.id -> { result, at }
let judgeFx = null;     // { text, color, at }
let combo = 0;
let maxCombo = 0;
let focusAnim = 1;      // 현재 포커스 레인 인덱스(부드럽게 따라감)
let shakeUntil = 0;
let shakeMag = 0;
let lastFrameAt = 0;

// ─────────────────────────────────────────────────────────────
// 캔버스 / 레이아웃
// ─────────────────────────────────────────────────────────────

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.floor(viewW * dpr);
  canvas.height = Math.floor(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initBackdrop();
}

function layout() {
  return {
    cx: viewW / 2,
    horizonY: viewH * 0.17,
    judgeY: viewH * 0.8,
    halfNear: Math.min(viewW * 0.44, viewH * 0.62),
  };
}

/**
 * 원근 투영.
 * t: 0 = 소실점(막 생성), 1 = 판정선. 1을 넘으면 판정선 아래로 지나간다.
 * 반환 s = 가로 스케일, u = 세로 위치 비율(0=소실점, 1=판정선).
 */
function project(t) {
  if (t <= 1) {
    const z = 1 - t;
    const s = 1 / (1 + PERSPECTIVE_K * z);
    return { s, u: (s - FAR_SCALE) / (1 - FAR_SCALE) };
  }
  const over = t - 1;
  return { s: 1 + over * 0.6, u: 1 + over * 0.45 };
}

function laneUnit(L) {
  return (2 * L.halfNear) / 3;
}

function laneCenterX(laneIndex, s, L) {
  return L.cx + (laneIndex - 1) * laneUnit(L) * s;
}

function edgeX(edgeIndex, s, L) {
  return L.cx + (edgeIndex - 1.5) * laneUnit(L) * s;
}

function depthY(u, L) {
  return L.horizonY + (L.judgeY - L.horizonY) * u;
}

function rgba(color, alpha) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

// ─────────────────────────────────────────────────────────────
// 배경(별/네뷸라) 생성
// ─────────────────────────────────────────────────────────────

function initBackdrop() {
  stars = Array.from({ length: 150 }, () => ({
    x: Math.random() * viewW,
    y: Math.random() * viewH * 0.8,
    r: Math.random() * 1.3 + 0.25,
    phase: Math.random() * Math.PI * 2,
    speed: 0.5 + Math.random() * 1.4,
  }));

  nebulas = [
    { x: viewW * 0.24, y: viewH * 0.2, r: viewW * 0.34, color: [255, 47, 208], a: 0.2 },
    { x: viewW * 0.78, y: viewH * 0.14, r: viewW * 0.3, color: [56, 232, 255], a: 0.16 },
    { x: viewW * 0.5, y: viewH * 0.05, r: viewW * 0.4, color: [120, 60, 255], a: 0.15 },
  ];

  buildBackdropSprite();
}

/*
  배경(수직 그라디언트 + 네뷸라 3개)은 움직이지 않으므로 리사이즈 때 한 번만
  오프스크린 캔버스에 그려두고, 매 프레임에는 통째로 blit 한다.
  풀스크린 radial gradient 를 매 프레임 3번 칠하면 고해상도에서 눈에 띄게 느려진다.
*/
function buildBackdropSprite() {
  if (viewW <= 0 || viewH <= 0) return;

  backdropSprite = document.createElement("canvas");
  backdropSprite.width = viewW;
  backdropSprite.height = viewH;
  const g = backdropSprite.getContext("2d");

  const base = g.createLinearGradient(0, 0, 0, viewH);
  base.addColorStop(0, "#0b0620");
  base.addColorStop(0.45, "#070414");
  base.addColorStop(1, "#03020a");
  g.fillStyle = base;
  g.fillRect(0, 0, viewW, viewH);

  g.globalCompositeOperation = "lighter";
  nebulas.forEach((n) => {
    const grd = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
    grd.addColorStop(0, rgba(n.color, n.a));
    grd.addColorStop(1, rgba(n.color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, viewW, viewH);
  });
}

// 파티클용 글로우 스프라이트(매 프레임 그라디언트 만들지 않도록 캐시)
const glowSprites = new Map();

function glowSprite(color) {
  const key = color.join(",");
  if (glowSprites.has(key)) return glowSprites.get(key);

  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, rgba(color, 1));
  grd.addColorStop(0.35, rgba(color, 0.55));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);

  glowSprites.set(key, c);
  return c;
}

// ─────────────────────────────────────────────────────────────
// 이펙트 생성
// ─────────────────────────────────────────────────────────────

function spawnHitEffect(lane, result) {
  const L = layout();
  const laneIndex = LANES.indexOf(lane);
  if (laneIndex < 0) return;

  const x = laneCenterX(laneIndex, 1, L);
  const y = L.judgeY;
  const perfect = result === "perfect";
  const base = perfect ? LANE_COLORS[lane] : COLOR_MISS;
  const count = perfect ? 28 : 12;

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (perfect ? 2.6 : 1.6);
    const speed = (perfect ? 180 : 90) * (0.35 + Math.random() * 0.95);
    particles.push({
      x: x + (Math.random() - 0.5) * laneUnit(L) * 0.7,
      y,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 90,
      vy: Math.sin(angle) * speed,
      life: 0,
      maxLife: perfect ? 520 + Math.random() * 380 : 340 + Math.random() * 200,
      size: (perfect ? 12 : 8) * (0.5 + Math.random()),
      color: Math.random() < 0.45 ? [255, 255, 255] : base,
    });
  }

  shockwaves.push({ x, y, life: 0, maxLife: perfect ? 480 : 320, color: perfect ? COLOR_PERFECT : COLOR_MISS });

  if (perfect) {
    beams.push({ laneIndex, life: 0, maxLife: 420, color: LANE_COLORS[lane] });
    shakeUntil = performance.now() + 110;
    shakeMag = 3;
  } else {
    shakeUntil = performance.now() + 90;
    shakeMag = 5;
  }

  judgeFx = {
    text: perfect ? "PERFECT" : "MISS",
    color: perfect ? COLOR_PERFECT : COLOR_MISS,
    at: performance.now(),
  };
}

function updateEffects(dt) {
  const now = performance.now();

  particles = particles.filter((p) => {
    p.life += dt;
    if (p.life >= p.maxLife) return false;
    const k = dt / 1000;
    p.x += p.vx * k;
    p.y += p.vy * k;
    p.vy += 320 * k; // 중력
    p.vx *= 0.985;
    return true;
  });

  shockwaves = shockwaves.filter((s) => {
    s.life += dt;
    return s.life < s.maxLife;
  });

  beams = beams.filter((b) => {
    b.life += dt;
    return b.life < b.maxLife;
  });

  if (judgeFx && now - judgeFx.at > 900) judgeFx = null;
}

// ─────────────────────────────────────────────────────────────
// 그리기
// ─────────────────────────────────────────────────────────────

function drawBackdrop(now) {
  if (backdropSprite) {
    ctx.drawImage(backdropSprite, 0, 0, viewW, viewH);
  } else {
    ctx.fillStyle = "#05030e";
    ctx.fillRect(0, 0, viewW, viewH);
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  stars.forEach((s) => {
    const tw = 0.45 + 0.55 * Math.abs(Math.sin(s.phase + (now / 1000) * s.speed));
    ctx.fillStyle = `rgba(255, 255, 255, ${tw * 0.85})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawHighway(now, L) {
  // 바닥 사다리꼴
  const topL = edgeX(0, FAR_SCALE, L);
  const topR = edgeX(3, FAR_SCALE, L);
  const botL = edgeX(0, 1, L);
  const botR = edgeX(3, 1, L);

  const floor = ctx.createLinearGradient(0, L.horizonY, 0, L.judgeY);
  floor.addColorStop(0, "rgba(30, 12, 60, 0.15)");
  floor.addColorStop(0.6, "rgba(18, 8, 42, 0.5)");
  floor.addColorStop(1, "rgba(10, 5, 26, 0.78)");
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.moveTo(topL, L.horizonY);
  ctx.lineTo(topR, L.horizonY);
  ctx.lineTo(botR, L.judgeY);
  ctx.lineTo(botL, L.judgeY);
  ctx.closePath();
  ctx.fill();

  // 앞으로 흘러오는 가로 그리드(속도감)
  const RUNGS = 16;
  const phase = ((now / 1500) % 1 + 1) % 1;
  ctx.lineWidth = 1;
  for (let i = 0; i < RUNGS; i++) {
    const t = (i + phase) / RUNGS;
    const { s, u } = project(t);
    const y = depthY(u, L);
    ctx.strokeStyle = `rgba(150, 120, 255, ${0.05 + u * 0.22})`;
    ctx.beginPath();
    ctx.moveTo(edgeX(0, s, L), y);
    ctx.lineTo(edgeX(3, s, L), y);
    ctx.stroke();
  }
}

function drawFocusLane(L) {
  const idx = focusAnim;
  const half = 0.5;
  const sFar = FAR_SCALE;

  const xTopL = L.cx + (idx - 1 - half) * laneUnit(L) * sFar;
  const xTopR = L.cx + (idx - 1 + half) * laneUnit(L) * sFar;
  const xBotL = L.cx + (idx - 1 - half) * laneUnit(L);
  const xBotR = L.cx + (idx - 1 + half) * laneUnit(L);

  const lane = LANES[Math.round(idx)] || "center";
  const color = LANE_COLORS[lane];

  const g = ctx.createLinearGradient(0, L.horizonY, 0, L.judgeY);
  g.addColorStop(0, rgba(color, 0.02));
  g.addColorStop(0.55, rgba(color, 0.1));
  g.addColorStop(1, rgba(color, 0.28));

  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(xTopL, L.horizonY);
  ctx.lineTo(xTopR, L.horizonY);
  ctx.lineTo(xBotR, L.judgeY);
  ctx.lineTo(xBotL, L.judgeY);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

function drawRails(now, L) {
  const pulse = 0.75 + 0.25 * Math.sin(now / 420);

  for (let e = 0; e <= 3; e++) {
    const outer = e === 0 || e === 3;
    const color = outer ? [255, 47, 208] : [130, 90, 255];
    const width = outer ? 3 : 1.5;
    const alpha = outer ? 0.95 * pulse : 0.4;

    const x0 = edgeX(e, FAR_SCALE, L);
    const x1 = edgeX(e, 1, L);

    const g = ctx.createLinearGradient(0, L.horizonY, 0, L.judgeY);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(0.25, rgba(color, alpha * 0.45));
    g.addColorStop(1, rgba(color, alpha));

    ctx.save();
    ctx.shadowColor = rgba(color, outer ? 0.9 : 0.5);
    ctx.shadowBlur = outer ? 22 : 10;
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, L.horizonY);
    ctx.lineTo(x1, L.judgeY);
    ctx.stroke();
    ctx.restore();
  }
}

function drawJudgmentZone(now, L, focusLane) {
  const left = edgeX(0, 1, L);
  const right = edgeX(3, 1, L);
  const y = L.judgeY;

  // 레인별 패드
  LANES.forEach((lane, i) => {
    const cx = laneCenterX(i, 1, L);
    const w = laneUnit(L) * 0.84;
    const h = Math.max(12, viewH * 0.022);
    const active = lane === focusLane;
    const color = LANE_COLORS[lane];
    const pulse = active ? 0.7 + 0.3 * Math.sin(now / 180) : 0.3;

    ctx.save();
    ctx.shadowColor = rgba(color, 0.95);
    ctx.shadowBlur = active ? 30 : 12;
    ctx.fillStyle = rgba(color, active ? 0.5 * pulse + 0.25 : 0.16);
    roundRect(cx - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.restore();

    if (active) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const sprite = glowSprite(color);
      const gw = w * 1.5;
      const gh = h * 6;
      ctx.globalAlpha = 0.5 * pulse;
      ctx.drawImage(sprite, cx - gw / 2, y - gh / 2, gw, gh);
      ctx.restore();
    }
  });

  // 판정선 본체
  ctx.save();
  ctx.shadowColor = "rgba(200, 240, 255, 0.9)";
  ctx.shadowBlur = 24;
  const g = ctx.createLinearGradient(left, 0, right, 0);
  g.addColorStop(0, "rgba(255, 47, 208, 0.85)");
  g.addColorStop(0.5, "rgba(255, 255, 255, 0.98)");
  g.addColorStop(1, "rgba(56, 232, 255, 0.85)");
  ctx.strokeStyle = g;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.stroke();
  ctx.restore();

  // 양끝 앵커
  [left, right].forEach((x) => {
    ctx.save();
    ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawBeams(L) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  beams.forEach((b) => {
    const k = 1 - b.life / b.maxLife;
    const cx = laneCenterX(b.laneIndex, 1, L);
    const w = laneUnit(L) * 0.8 * (0.6 + 0.4 * k);
    const g = ctx.createLinearGradient(0, L.judgeY, 0, L.horizonY);
    g.addColorStop(0, rgba(b.color, 0.55 * k));
    g.addColorStop(0.35, rgba(b.color, 0.2 * k));
    g.addColorStop(1, rgba(b.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - w / 2, L.horizonY, w, L.judgeY - L.horizonY);
  });
  ctx.restore();
}

function drawNotes(notes, nowMs) {
  const L = layout();
  const unit = laneUnit(L);

  // 먼 것부터 그려서 가까운 노트가 위에 오도록
  const sorted = [...notes].sort((a, b) => a.progress - b.progress);

  sorted.forEach((note) => {
    const laneIndex = LANES.indexOf(note.lane);
    if (laneIndex < 0) return;

    const t = Math.min(note.progress, 1.3);
    const { s, u } = project(t);
    const x = laneCenterX(laneIndex, s, L);
    const y = depthY(u, L);

    const fx = noteFx.get(note.id);
    const age = fx ? nowMs - fx.at : 0;

    let w = unit * 0.82 * s;
    let h = Math.max(9, viewH * 0.026) * s;
    let alpha = Math.min(1, 0.25 + u * 1.5);
    let color = LANE_COLORS[note.lane];

    if (fx && fx.result === "perfect") {
      const k = Math.min(1, age / 260);
      w *= 1 + k * 0.9;
      h *= 1 + k * 0.5;
      alpha = (1 - k) * 0.95;
      color = COLOR_PERFECT;
    } else if (fx && fx.result === "miss") {
      const k = Math.min(1, age / 320);
      alpha = (1 - k) * 0.7;
      color = COLOR_MISS;
    }

    if (alpha <= 0.02) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 글로우
    ctx.shadowColor = rgba(color, 0.95);
    ctx.shadowBlur = 22 * Math.max(0.35, s);

    const body = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    body.addColorStop(0, "rgba(255, 255, 255, 0.98)");
    body.addColorStop(0.42, rgba(color, 0.95));
    body.addColorStop(1, rgba(color, 0.55));
    ctx.fillStyle = body;
    roundRect(x - w / 2, y - h / 2, w, h, h * 0.45);
    ctx.fill();

    // 윗면 하이라이트
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * alpha})`;
    ctx.lineWidth = Math.max(1, 1.6 * s);
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + h * 0.35, y - h / 2 + 0.5);
    ctx.lineTo(x + w / 2 - h * 0.35, y - h / 2 + 0.5);
    ctx.stroke();

    ctx.restore();
  });
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  particles.forEach((p) => {
    const k = 1 - p.life / p.maxLife;
    const size = p.size * (0.4 + k * 1.2);
    ctx.globalAlpha = Math.max(0, k * k);
    const sprite = glowSprite(p.color);
    ctx.drawImage(sprite, p.x - size, p.y - size, size * 2, size * 2);
  });
  ctx.restore();
}

function drawShockwaves() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  shockwaves.forEach((s) => {
    const k = s.life / s.maxLife;
    const rx = 40 + k * 260;
    const ry = rx * 0.28;
    ctx.globalAlpha = (1 - k) * 0.75;
    ctx.strokeStyle = rgba(s.color, 1);
    ctx.lineWidth = Math.max(1, 5 * (1 - k));
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
}

function drawHud(state, now) {
  const pad = Math.max(18, viewW * 0.022);

  // 좌상단 SCORE
  ctx.save();
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(160, 170, 210, 0.9)";
  ctx.font = `700 11px ${FONT_HUD}`;
  ctx.letterSpacing = "3px";
  ctx.fillText("SCORE", pad, pad + 10);

  ctx.shadowColor = "rgba(56, 232, 255, 0.8)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 ${Math.max(30, viewW * 0.032)}px ${FONT_HUD}`;
  ctx.fillText(String(state.score).padStart(5, "0"), pad, pad + 10 + Math.max(32, viewW * 0.034));
  ctx.restore();

  // 우상단 TIME
  ctx.save();
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(160, 170, 210, 0.9)";
  ctx.font = `700 11px ${FONT_HUD}`;
  ctx.fillText("TIME", viewW - pad, pad + 10);

  const urgent = state.remaining <= 5;
  ctx.shadowColor = urgent ? "rgba(255, 77, 106, 0.9)" : "rgba(176, 108, 255, 0.75)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = urgent ? "#ff7a90" : "#ffffff";
  ctx.font = `700 ${Math.max(26, viewW * 0.026)}px ${FONT_HUD}`;
  ctx.fillText(state.remaining.toFixed(1), viewW - pad, pad + 10 + Math.max(30, viewW * 0.03));
  ctx.restore();

  // 시간 게이지 (상단 가로바)
  const total = 30;
  const ratio = Math.max(0, Math.min(1, state.remaining / total));
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.fillRect(0, 0, viewW, 3);
  const g = ctx.createLinearGradient(0, 0, viewW, 0);
  g.addColorStop(0, "#38e8ff");
  g.addColorStop(1, "#ff2fd0");
  ctx.fillStyle = g;
  ctx.shadowColor = "rgba(255, 47, 208, 0.8)";
  ctx.shadowBlur = 12;
  ctx.fillRect(0, 0, viewW * ratio, 3);
  ctx.restore();

  drawAccuracyGauge(state, pad);
  drawCenterFx(now);
}

function drawAccuracyGauge(state, pad) {
  const judged = state.perfect_count + state.miss_count;
  const acc = judged > 0 ? state.perfect_count / judged : 1;

  const w = 8;
  const h = Math.min(viewH * 0.3, 240);
  const x = pad;
  const y = viewH * 0.4;

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  roundRect(x, y, w, h, w / 2);
  ctx.fill();

  const fillH = h * acc;
  const g = ctx.createLinearGradient(0, y + h, 0, y);
  g.addColorStop(0, "#38e8ff");
  g.addColorStop(1, "#ff2fd0");
  ctx.fillStyle = g;
  ctx.shadowColor = "rgba(56, 232, 255, 0.8)";
  ctx.shadowBlur = 16;
  roundRect(x, y + h - fillH, w, fillH, w / 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(230, 240, 255, 0.92)";
  ctx.font = `700 13px ${FONT_HUD}`;
  ctx.fillText(`${Math.round(acc * 100)}%`, x + w + 8, y + h - fillH + 5);
  ctx.restore();
}

function drawCenterFx(now) {
  const cx = viewW / 2;

  if (combo >= 2) {
    const pop = judgeFx ? Math.max(0, 1 - (now - judgeFx.at) / 220) : 0;
    const scale = 1 + pop * 0.28;

    ctx.save();
    ctx.textAlign = "center";
    ctx.translate(cx, viewH * 0.4);
    ctx.scale(scale, scale);

    ctx.fillStyle = "rgba(190, 200, 235, 0.55)";
    ctx.font = `700 12px ${FONT_HUD}`;
    ctx.fillText("C O M B O", 0, -Math.max(30, viewH * 0.042));

    ctx.shadowColor = "rgba(176, 108, 255, 0.9)";
    ctx.shadowBlur = 26;
    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.font = `900 ${Math.max(52, viewH * 0.085)}px ${FONT_HUD}`;
    ctx.fillText(String(combo), 0, 0);
    ctx.restore();
  }

  if (judgeFx) {
    const age = now - judgeFx.at;
    const k = Math.min(1, age / 200);
    const fade = Math.max(0, 1 - Math.max(0, age - 420) / 480);
    if (fade > 0) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.globalAlpha = fade;
      ctx.translate(cx, viewH * 0.47);
      ctx.scale(1 + (1 - k) * 0.5, 1 + (1 - k) * 0.5);
      ctx.shadowColor = rgba(judgeFx.color, 0.95);
      ctx.shadowBlur = 24;
      ctx.fillStyle = rgba(judgeFx.color, 1);
      ctx.font = `900 ${Math.max(26, viewH * 0.04)}px ${FONT_HUD}`;
      ctx.letterSpacing = "6px";
      ctx.fillText(judgeFx.text, 0, 0);
      ctx.restore();
    }
  }
}

function drawMissVignette(now) {
  if (!judgeFx || judgeFx.text !== "MISS") return;
  const k = Math.max(0, 1 - (now - judgeFx.at) / 400);
  if (k <= 0) return;

  const g = ctx.createRadialGradient(viewW / 2, viewH / 2, viewH * 0.3, viewW / 2, viewH / 2, viewH * 0.75);
  g.addColorStop(0, "rgba(255, 60, 90, 0)");
  g.addColorStop(1, `rgba(255, 60, 90, ${0.3 * k})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, viewH);
}

// ─────────────────────────────────────────────────────────────
// 메인 렌더 루프
// ─────────────────────────────────────────────────────────────

/**
 * 서버 상태(~15fps)를 현재 시각 기준으로 보간해 60fps로 부드럽게 만든다.
 * 판정은 전부 서버가 하므로 이 보간은 순수하게 "보이는 위치"에만 영향을 준다.
 */
function interpolatedNotes() {
  if (!serverState) return [];
  if (serverState.paused) return serverState.notes;

  const dt = performance.now() - serverStateAt;
  const advance = dt / NOTE_FALL_DURATION_MS;

  return serverState.notes.map((note) => ({
    ...note,
    // 이미 판정된 노트는 그 자리에서 이펙트만 재생 (진행 정지)
    progress: note.result ? note.progress : Math.min(1.3, note.progress + advance),
  }));
}

function render(now) {
  rafId = requestAnimationFrame(render);

  const dt = lastFrameAt ? Math.min(64, now - lastFrameAt) : 16;
  lastFrameAt = now;

  const state = serverState;
  if (!state) {
    drawBackdrop(now);
    return;
  }

  updateEffects(dt);

  // 포커스 레인 부드럽게 이동
  const targetIdx = Math.max(0, LANES.indexOf(state.focus_lane));
  focusAnim += (targetIdx - focusAnim) * Math.min(1, dt / 90);

  const L = layout();

  ctx.save();
  if (now < shakeUntil) {
    const k = (shakeUntil - now) / 110;
    ctx.translate((Math.random() - 0.5) * shakeMag * k * 2, (Math.random() - 0.5) * shakeMag * k * 2);
  }

  drawBackdrop(now);
  drawHighway(now, L);
  drawFocusLane(L);
  drawRails(now, L);
  drawBeams(L);
  drawJudgmentZone(now, L, state.focus_lane);
  drawNotes(interpolatedNotes(), now);
  drawShockwaves();
  drawParticles();
  drawMissVignette(now);
  drawHud(state, now);

  ctx.restore();
}

function startRenderLoop() {
  if (rafId === null) {
    lastFrameAt = 0;
    rafId = requestAnimationFrame(render);
  }
}

function stopRenderLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// ─────────────────────────────────────────────────────────────
// 서버 상태 수신
// ─────────────────────────────────────────────────────────────

function applyState(state) {
  const now = performance.now();

  // 판정 이벤트는 "발생한 그 프레임"에만 서버가 실어보낸다.
  // 단, 일시정지 중에는 서버가 직전 값을 계속 재전송하므로 그때는 무시해야
  // 콤보가 중복으로 올라가지 않는다.
  if (state.last_judgment && !state.paused) {
    const { lane, result } = state.last_judgment;
    if (result === "perfect") {
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
    } else {
      combo = 0;
    }
    spawnHitEffect(lane, result);
  }

  // 노트별 판정 시각 기록(노트 팝/페이드 애니메이션용)
  const alive = new Set();
  state.notes.forEach((note) => {
    alive.add(note.id);
    if (note.result && !noteFx.has(note.id)) {
      noteFx.set(note.id, { result: note.result, at: now });
    }
  });
  noteFx.forEach((_, id) => {
    if (!alive.has(id)) noteFx.delete(id);
  });

  serverState = state;
  serverStateAt = now;
}

function resetVisualState() {
  particles = [];
  shockwaves = [];
  beams = [];
  noteFx = new Map();
  judgeFx = null;
  combo = 0;
  maxCombo = 0;
  focusAnim = 1;
  shakeUntil = 0;
  serverState = null;
  serverStateAt = 0;
}

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
        const hit = Math.random() < 0.78; // perfect / miss 이펙트를 둘 다 보여주기 위해
        n.result = hit ? "perfect" : "miss";
        n.resultAt = elapsed;
        if (hit) {
          perfectCount += 1;
          score += 100;
        } else {
          missCount += 1;
        }
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

  // 데모 모드엔 서버가 없으므로 정지 상태를 직접 상태값에 반영해준다.
  if (DEMO && serverState) {
    serverState = { ...serverState, paused: isPaused };
    serverStateAt = performance.now();
  }
}

function showResult(state) {
  stopRenderLoop();
  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");

  resultScoreEl.textContent = state.score;
  if (resultComboEl) resultComboEl.textContent = maxCombo;
  if (resultPerfectEl) resultPerfectEl.textContent = state.perfect_count;
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
