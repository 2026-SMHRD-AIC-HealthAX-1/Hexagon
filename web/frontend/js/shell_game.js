/*
  야바위 게임(테스트 버전) - 로직 + 캔버스 렌더링.

  시선 추적과 무관한 순수 마우스 클릭 게임이라 MediaPipe/카메라/웹소켓이
  전혀 없다. 다른 두 미니게임(js/gaze/, js/rhythm/)처럼 파이썬 원본과
  맞춰야 하는 포팅물이 아니어서, 파생 클래스 구조 없이 이 파일 하나에
  상태 + 업데이트 + 렌더링을 전부 둔다.

  게임 흐름 (한 라운드):
    intro   - (1라운드에만) 컵이 자리로 떨어져 들어온다
    reveal  - 공이 든 컵을 들어올려 보여준 뒤 다시 덮는다
    shuffle - 15초 동안 두 컵씩 계속 자리를 바꾼다(끊김 없이 다음 스왑으로 이어짐)
    choose  - 셔플이 멈추고, 클릭으로 컵을 고를 때까지 대기
    result  - 고른 컵(+ 오답이면 정답 컵도) 들어올려 결과를 보여줌
              정답이면 다음 라운드(reveal부터, 속도/점수 상향)로,
              오답이면 결과 화면으로 전환
*/

// ── 상수 ────────────────────────────────────────────────────
// 캔버스/컵/공 크기 (2026-09-17: 화면 대비 너무 작다는 피드백으로 확대 -
// 컵을 키우려면 reveal 때 들어올린 컵 윗부분이 캔버스 위쪽에 잘리지 않도록
// 세로 여백도 함께 늘려야 해서 캔버스 자체도 같이 키웠다)
const CANVAS_W = 700;
const CANVAS_H = 440;
const BASE_Y = CANVAS_H * 0.68;
const SLOT_X = [CANVAS_W * 0.16, CANVAS_W * 0.5, CANVAS_W * 0.84];

const CUP_WIDTH = 160;
const CUP_HEIGHT = 145;
const BALL_RADIUS = 22;
const LIFT_HEIGHT = 140;

const ARC_HEIGHT_OVER = 85;
const ARC_HEIGHT_UNDER = 32;

const SHUFFLE_DURATION_MS = 15000;
const SWAP_DURATION_BASE_MS = 650;
const SWAP_DURATION_MIN_MS = 220;
// 레벨당 스왑 소요시간 감소폭(=섞는 속도 증가폭) - 2026-09-17에 기존 40 대비
// 2배로 올려달라는 요청으로 80으로 변경. MIN까지 도달하는 레벨 수가
// 그만큼 절반으로 줄어든다(약 10레벨 -> 약 5레벨).
const SWAP_DURATION_STEP_MS = 80;

const INTRO_MS = 550;
const REVEAL_LIFT_HOLD_MS = 1250;
const REVEAL_LOWER_MS = 450;
const RESULT_HOLD_MS = 1500;

const LIFT_TAU_MS = 90; // 컵 들어올림/내림 애니메이션의 반응 속도
const ENTRY_TAU_MS = 110; // 1라운드 등장 애니메이션의 반응 속도

const SCORE_BASE = 100;
const SCORE_STEP = 50;

const PHASE_MESSAGES = {
  intro: "컵이 준비되고 있습니다...",
  reveal: "공이 어느 컵에 들어가는지 잘 보세요!",
  choose: "공이 있을 것 같은 컵을 클릭하세요",
};

// ── DOM ─────────────────────────────────────────────────────
const startScreen = document.getElementById("start-screen");
const playScreen = document.getElementById("play-screen");
const resultScreen = document.getElementById("result-screen");

const startBtn = document.getElementById("start-btn");
const retryBtn = document.getElementById("retry-btn");

const hudLevelEl = document.getElementById("hud-level");
const hudScoreEl = document.getElementById("hud-score");
const phaseMessageEl = document.getElementById("phase-message");

const resultScoreEl = document.getElementById("result-score");
const resultLevelEl = document.getElementById("result-level");

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

// ── 캔버스 초기화 (고해상도 대응) ───────────────────────────
function setupCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
setupCanvas();

// ── 유틸 ────────────────────────────────────────────────────
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** [0,1,2] 중 서로 다른 두 슬롯 인덱스를 고른다 (순서 상관없음). */
function pickSwapPair() {
  const a = Math.floor(Math.random() * 3);
  let b = Math.floor(Math.random() * 2);
  if (b >= a) b += 1;
  return [a, b];
}

/** 레벨이 올라갈수록 스왑 하나의 소요 시간이 짧아진다(=더 빨리 섞인다). */
function swapDurationForLevel(level) {
  return Math.max(SWAP_DURATION_MIN_MS, SWAP_DURATION_BASE_MS - (level - 1) * SWAP_DURATION_STEP_MS);
}

/** 레벨이 올라갈수록 해당 단계를 맞혔을 때 얻는 점수도 커진다. */
function scoreForLevel(level) {
  return SCORE_BASE + (level - 1) * SCORE_STEP;
}

/** dt(ms) 동안 tau(ms) 시정수로 target 쪽으로 감쇠 이동하는 보간 계수. */
function easeFactor(dt, tauMs) {
  return 1 - Math.exp(-dt / tauMs);
}

// ── 게임 상태 ───────────────────────────────────────────────
const state = {
  phase: "idle", // idle | intro | reveal | shuffle | choose | result
  phaseStart: 0,
  level: 1,
  score: 0,
  cups: [],
  swap: null, // 진행 중인 스왑 정보 (없으면 null)
  shuffleStart: 0,
  lastCorrect: false,
};

let rafId = null;
let lastFrameAt = 0;

function makeCup(slot) {
  return {
    slot,
    x: SLOT_X[slot],
    yOffset: 0, // 셔플 중 아치 이동에 쓰는 상대 y (음수 = 위로)
    entryY: 0, // 1라운드 등장 애니메이션용 상대 y
    lift: 0, // 0~1, 들어올림 정도 (reveal/result 전용)
    liftTarget: 0,
    hasBall: false,
  };
}

function startRound(isFirstRound) {
  state.cups = [0, 1, 2].map(makeCup);
  state.cups[Math.floor(Math.random() * 3)].hasBall = true;
  state.swap = null;

  const now = performance.now();
  if (isFirstRound) {
    setPhase("intro", now);
  } else {
    setPhase("reveal", now);
  }
}

function setPhase(phase, now) {
  state.phase = phase;
  state.phaseStart = now;

  if (phase === "intro") {
    for (const cup of state.cups) cup.entryY = 220;
  }

  if (phase === "reveal") {
    const ballCup = state.cups.find((c) => c.hasBall);
    ballCup.liftTarget = 1;
  }

  if (phase === "shuffle") {
    state.shuffleStart = now;
    state.swap = null;
  }

  updatePhaseMessage();
}

function updatePhaseMessage() {
  if (state.phase === "shuffle") return; // 매 프레임 카운트다운으로 갱신
  if (state.phase === "result") {
    phaseMessageEl.textContent = state.lastCorrect
      ? "정답입니다! 다음 단계로 진행합니다."
      : "오답입니다. 게임 종료!";
    return;
  }
  phaseMessageEl.textContent = PHASE_MESSAGES[state.phase] || "";
}

function updateHud() {
  hudLevelEl.textContent = state.level;
  hudScoreEl.textContent = state.score;
}

// ── 셔플(스왑 체이닝) ───────────────────────────────────────
function startNextSwap(now) {
  const [a, b] = pickSwapPair();
  const aId = state.cups.findIndex((c) => c.slot === a);
  const bId = state.cups.findIndex((c) => c.slot === b);
  const aOver = Math.random() < 0.5;

  state.swap = {
    slotA: a,
    slotB: b,
    aId,
    bId,
    startedAt: now,
    duration: swapDurationForLevel(state.level),
    arcA: aOver ? ARC_HEIGHT_OVER : ARC_HEIGHT_UNDER,
    arcB: aOver ? ARC_HEIGHT_UNDER : ARC_HEIGHT_OVER,
    overId: aOver ? aId : bId,
  };
}

function updateShuffle(now) {
  if (!state.swap) {
    startNextSwap(now);
  }

  const sw = state.swap;
  const t = Math.min(1, (now - sw.startedAt) / sw.duration);
  const eased = easeInOutQuad(t);

  const cupA = state.cups[sw.aId];
  const cupB = state.cups[sw.bId];

  cupA.x = lerp(SLOT_X[sw.slotA], SLOT_X[sw.slotB], eased);
  cupB.x = lerp(SLOT_X[sw.slotB], SLOT_X[sw.slotA], eased);
  cupA.yOffset = -sw.arcA * Math.sin(Math.PI * t);
  cupB.yOffset = -sw.arcB * Math.sin(Math.PI * t);

  if (t >= 1) {
    cupA.slot = sw.slotB;
    cupB.slot = sw.slotA;
    cupA.x = SLOT_X[cupA.slot];
    cupB.x = SLOT_X[cupB.slot];
    cupA.yOffset = 0;
    cupB.yOffset = 0;
    state.swap = null;

    if (now - state.shuffleStart >= SHUFFLE_DURATION_MS) {
      setPhase("choose", now);
    }
    // else: 다음 프레임의 updateShuffle()이 곧바로 다음 스왑을 이어 붙인다
    // (프레임 사이 공백 없이 바로 이어지므로 움직임이 끊기지 않는다)
  }
}

// ── 메인 업데이트 ───────────────────────────────────────────
function update(now, dt) {
  for (const cup of state.cups) {
    cup.lift += (cup.liftTarget - cup.lift) * easeFactor(dt, LIFT_TAU_MS);
    if (cup.entryY) cup.entryY += (0 - cup.entryY) * easeFactor(dt, ENTRY_TAU_MS);
  }

  const elapsed = now - state.phaseStart;

  switch (state.phase) {
    case "intro":
      if (elapsed >= INTRO_MS) setPhase("reveal", now);
      break;

    case "reveal": {
      if (elapsed >= REVEAL_LIFT_HOLD_MS) {
        const ballCup = state.cups.find((c) => c.hasBall);
        ballCup.liftTarget = 0;
      }
      if (elapsed >= REVEAL_LIFT_HOLD_MS + REVEAL_LOWER_MS) {
        setPhase("shuffle", now);
      }
      break;
    }

    case "shuffle": {
      updateShuffle(now);
      // updateShuffle()이 이 프레임 안에서 곧장 choose로 전환했을 수 있다 -
      // 그럴 때 아래에서 카운트다운 문구를 덮어쓰면 setPhase("choose")가
      // 이미 넣어둔 안내 문구가 무효화되어, 실제로는 클릭 대기 상태인데도
      // 화면엔 "남은 시간 0초"가 그대로 멈춰 보이는 버그가 된다.
      if (state.phase === "shuffle") {
        const remainingMs = Math.max(0, SHUFFLE_DURATION_MS - (now - state.shuffleStart));
        phaseMessageEl.textContent = `섞는 중입니다... 남은 시간 ${Math.ceil(remainingMs / 1000)}초`;
      }
      break;
    }

    case "choose":
      break; // 클릭 대기 (onCanvasClick 에서 처리)

    case "result":
      if (elapsed >= RESULT_HOLD_MS) {
        if (state.lastCorrect) {
          state.score += scoreForLevel(state.level);
          state.level += 1;
          updateHud();
          startRound(false);
        } else {
          endGame();
        }
      }
      break;

    default:
      break;
  }
}

// ── 렌더링 ──────────────────────────────────────────────────
function drawTable() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  bg.addColorStop(0, "#0d3d24");
  bg.addColorStop(1, "#062015");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.save();
  ctx.globalAlpha = 0.28;
  const glow = ctx.createRadialGradient(CANVAS_W / 2, BASE_Y, 20, CANVAS_W / 2, BASE_Y, CANVAS_W * 0.6);
  glow.addColorStop(0, "#1c6b3e");
  glow.addColorStop(1, "rgba(28, 107, 62, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();

  ctx.strokeStyle = "rgba(232, 193, 90, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, BASE_Y + 18);
  ctx.lineTo(CANVAS_W - 20, BASE_Y + 18);
  ctx.stroke();
}

function drawBall(x, y) {
  const grad = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, BALL_RADIUS);
  grad.addColorStop(0, "#fff8e0");
  grad.addColorStop(1, "#e8b13a");
  ctx.beginPath();
  ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}

function drawCup(cup) {
  const x = cup.x;
  const totalYOffset = cup.yOffset + cup.entryY - cup.lift * LIFT_HEIGHT;
  const bottomY = BASE_Y + totalYOffset;
  const topY = bottomY - CUP_HEIGHT;
  const halfBottom = CUP_WIDTH / 2;
  const halfTop = CUP_WIDTH * 0.32;

  // 바닥 그림자 - 컵이 뜰수록(entryY/lift) 옅어져서 붕 뜬 느낌을 준다
  const grounded = Math.max(0, 1 - cup.lift - Math.abs(cup.entryY) / 220);
  ctx.save();
  ctx.globalAlpha = 0.35 * grounded;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, BASE_Y + 10, halfBottom * 0.8, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 공 - reveal/result 단계에서만, 컵보다 먼저 그려서 컵이 덮도록 한다
  if (cup.hasBall && (state.phase === "reveal" || state.phase === "result")) {
    drawBall(x, BASE_Y - BALL_RADIUS * 0.6);
  }

  const grad = ctx.createLinearGradient(x - halfBottom, topY, x + halfBottom, bottomY);
  grad.addColorStop(0, "#7a1f2b");
  grad.addColorStop(0.5, "#b0303f");
  grad.addColorStop(1, "#7a1f2b");

  ctx.beginPath();
  ctx.moveTo(x - halfTop, topY + 14);
  ctx.quadraticCurveTo(x, topY - 6, x + halfTop, topY + 14);
  ctx.lineTo(x + halfBottom, bottomY);
  ctx.quadraticCurveTo(x, bottomY + 10, x - halfBottom, bottomY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = "#e8c15a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, bottomY, halfBottom, 8, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function draw() {
  drawTable();

  const overId = state.swap ? state.swap.overId : -1;
  const order = state.cups
    .map((_, i) => i)
    .sort((i, j) => {
      const pi = (i === overId ? 2 : 0) + (state.cups[i].lift > 0.02 ? 1 : 0);
      const pj = (j === overId ? 2 : 0) + (state.cups[j].lift > 0.02 ? 1 : 0);
      return pi - pj;
    });

  for (const i of order) drawCup(state.cups[i]);
}

// ── 입력 처리 ───────────────────────────────────────────────
function canvasPoint(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_W / rect.width;
  const scaleY = CANVAS_H / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

function cupAt(x, y) {
  return state.cups.find((cup) => {
    const left = cup.x - CUP_WIDTH / 2;
    const right = cup.x + CUP_WIDTH / 2;
    const top = BASE_Y - CUP_HEIGHT - cup.lift * LIFT_HEIGHT - 10;
    const bottom = BASE_Y + 16;
    return x >= left && x <= right && y >= top && y <= bottom;
  });
}

function onCanvasClick(evt) {
  if (state.phase !== "choose") return;

  const { x, y } = canvasPoint(evt);
  const clicked = cupAt(x, y);
  if (!clicked) return;

  const correct = state.cups.find((c) => c.hasBall);
  clicked.liftTarget = 1;
  if (correct !== clicked) correct.liftTarget = 1;

  state.lastCorrect = clicked === correct;
  setPhase("result", performance.now());
}

function onCanvasMouseMove(evt) {
  if (state.phase !== "choose") {
    canvas.style.cursor = "default";
    return;
  }
  const { x, y } = canvasPoint(evt);
  canvas.style.cursor = cupAt(x, y) ? "pointer" : "default";
}

// ── 화면 전환 ───────────────────────────────────────────────
function startGame() {
  startScreen.classList.add("hidden");
  resultScreen.classList.add("hidden");
  playScreen.classList.remove("hidden");

  state.level = 1;
  state.score = 0;
  updateHud();
  startRound(true);

  lastFrameAt = 0;
  if (rafId === null) rafId = requestAnimationFrame(loop);
}

function endGame() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  playScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");
  resultScoreEl.textContent = state.score;
  resultLevelEl.textContent = state.level;
}

// ── 메인 루프 ───────────────────────────────────────────────
function loop(now) {
  rafId = requestAnimationFrame(loop);
  const dt = lastFrameAt ? Math.min(48, now - lastFrameAt) : 16;
  lastFrameAt = now;

  update(now, dt);
  draw();
}

// ── 초기화 ──────────────────────────────────────────────────
startBtn.addEventListener("click", startGame);
retryBtn.addEventListener("click", startGame);
canvas.addEventListener("click", onCanvasClick);
canvas.addEventListener("mousemove", onCanvasMouseMove);
