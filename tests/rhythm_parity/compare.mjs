/*
  gameEngine.js(JS 포팅본)를 rhythm_game_session.py(원본) 기준값과 비교한다.

  같은 시간축/시선/깜빡임/난수를 주입해 같은 판정·점수가 나오는지 프레임 단위로
  대조한다. 시간 단위만 다르므로(파이썬 초, JS 밀리초) 부동소수점 오차를 감안해
  실수값은 1e-6 허용오차로 비교하고, 나머지(레인/판정/점수/노트 id)는 완전 일치를 요구한다.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RhythmGameEngine } from "./rhythm/gameEngine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, "fixture.json"), "utf-8"));

const { frames, lane_x: laneX, spawn_delays: spawnDelays, lane_choices: laneChoices,
        pause_at: pauseAt, resume_at: resumeAt, pause_gap_ms: pauseGapMs } = fixture.input;
const expectedStates = fixture.expected.states;

// ── 결정론적 주입 ────────────────────────────────────────────
const clock = { ms: 0 };

let delayIndex = 0;
let choiceIndex = 0;

const blinkMonitor = {
  value: false,
  update() {
    return { is_blinking: this.value };
  },
};

const engine = new RhythmGameEngine(laneX, {
  // 파이썬 쪽은 compute_gaze(landmarks, smoother) 를 스텁으로 갈아끼웠다.
  computeGaze: (landmarks) => [landmarks.gaze_x, 0.5],
  smoother: null,
  blinkMonitor,
  now: () => clock.ms,
  randint: () => spawnDelays[delayIndex++ % spawnDelays.length],
  choice: () => laneChoices[choiceIndex++ % laneChoices.length],
});

// ── 재생 ────────────────────────────────────────────────────
const EPS = 1e-6;
const problems = [];

function closeEnough(a, b) {
  return Math.abs(a - b) <= EPS;
}

// remaining 은 화면에 보여주는 용도로 소수 1자리 반올림된 값이다.
// 파이썬은 time.time()(초)을 ms 로 되돌리면서 4e-12 수준의 오차가 붙는데,
// 그 값이 반올림 경계에 걸리면 한 칸(0.1) 차이가 난다. 판정에 쓰이는
// finished 는 반올림 전 값으로 계산되므로 아래에서 정확히 비교한다.
// 따라서 remaining 은 "한 반올림 단위 이내"만 허용하고, 몇 번 갈렸는지는
// 숨기지 않고 따로 집계해서 보고한다.
let roundingDiffFrames = 0;

function compareState(index, got, exp) {
  const add = (msg) => problems.push(`frame ${index}: ${msg}`);

  if (got.paused !== exp.paused) add(`paused ${got.paused} != ${exp.paused}`);
  if (got.focus_lane !== exp.focus_lane) add(`focus_lane ${got.focus_lane} != ${exp.focus_lane}`);
  if (got.score !== exp.score) add(`score ${got.score} != ${exp.score}`);
  if (got.perfect_count !== exp.perfect_count) add(`perfect_count ${got.perfect_count} != ${exp.perfect_count}`);
  if (got.great_count !== exp.great_count) add(`great_count ${got.great_count} != ${exp.great_count}`);
  if (got.good_count !== exp.good_count) add(`good_count ${got.good_count} != ${exp.good_count}`);
  if (got.miss_count !== exp.miss_count) add(`miss_count ${got.miss_count} != ${exp.miss_count}`);
  if (got.finished !== exp.finished) add(`finished ${got.finished} != ${exp.finished}`);

  if (!closeEnough(got.remaining, exp.remaining)) {
    if (Math.abs(got.remaining - exp.remaining) <= 0.1 + EPS) {
      roundingDiffFrames++;
    } else {
      add(`remaining ${got.remaining} != ${exp.remaining} (반올림 한 칸을 넘는 차이)`);
    }
  }

  const gj = got.last_judgment;
  const ej = exp.last_judgment;
  if (!!gj !== !!ej) {
    add(`last_judgment ${JSON.stringify(gj)} != ${JSON.stringify(ej)}`);
  } else if (gj && ej && (gj.lane !== ej.lane || gj.result !== ej.result)) {
    add(`last_judgment ${JSON.stringify(gj)} != ${JSON.stringify(ej)}`);
  }

  if (got.notes.length !== exp.notes.length) {
    add(`notes 개수 ${got.notes.length} != ${exp.notes.length}`);
    return;
  }
  for (let n = 0; n < got.notes.length; n++) {
    const g = got.notes[n];
    const e = exp.notes[n];
    if (g.id !== e.id) add(`notes[${n}].id ${g.id} != ${e.id}`);
    if (g.lane !== e.lane) add(`notes[${n}].lane ${g.lane} != ${e.lane}`);
    if (g.result !== e.result) add(`notes[${n}].result ${g.result} != ${e.result}`);
    if (!closeEnough(g.progress, e.progress)) {
      add(`notes[${n}].progress ${g.progress} != ${e.progress}`);
    }
  }
}

let judgmentCount = 0;

for (let i = 0; i < frames.length; i++) {
  const frame = frames[i];

  if (i === pauseAt) {
    clock.ms = frame.elapsed_ms;
    engine.pause();
  }
  if (i === resumeAt) {
    clock.ms = frame.elapsed_ms + pauseGapMs;
    engine.resume();
  }

  clock.ms = frame.elapsed_ms + (i >= resumeAt ? pauseGapMs : 0);
  blinkMonitor.value = frame.is_blinking;

  const state = engine.process({ gaze_x: frame.gaze_x });
  if (state.last_judgment) judgmentCount++;

  compareState(i, state, expectedStates[i]);
}

// ── 결과 ────────────────────────────────────────────────────
const final = expectedStates[expectedStates.length - 1];

console.log("=== Python vs JS 리듬게임 판정 로직 검증 ===\n");
console.log(`재생 프레임: ${frames.length} (일시정지 ${pauseAt}~${resumeAt} 프레임 포함)`);
console.log(`판정 이벤트: ${judgmentCount}회`);
console.log(`최종 상태 기준값: score=${final.score} perfect=${final.perfect_count} great=${final.great_count} good=${final.good_count} miss=${final.miss_count} finished=${final.finished}`);
console.log("");

if (problems.length === 0) {
  console.log("PASS  판정/점수/노트 상태가 전 프레임 일치");
  console.log("      (focus_lane, last_judgment, score, perfect/miss count,");
  console.log("       notes 의 id/lane/result/progress, finished 전부 정확히 동일)");

  if (roundingDiffFrames > 0) {
    console.log("");
    console.log(`참고  remaining(화면 표시용 타이머)만 ${roundingDiffFrames}/${frames.length} 프레임에서 0.1 차이.`);
    console.log("      파이썬이 초<->ms 를 오가며 생기는 4e-12 오차가 반올림 경계를");
    console.log("      넘긴 경우로, 판정에 쓰이는 finished 는 반올림 전 값으로");
    console.log("      계산되므로 게임 동작에는 영향이 없다.");
  }

  console.log("\n전체 결과: ALL PASS");
  process.exit(0);
}

console.log(`FAIL  불일치 ${problems.length}건 (앞 15건만 표시)`);
for (const p of problems.slice(0, 15)) console.log(`  ${p}`);
console.log("\n전체 결과: FAIL");
process.exit(1);
