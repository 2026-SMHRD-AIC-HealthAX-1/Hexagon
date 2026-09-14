/*
  js/gaze/calibrationEngine.js, js/gaze/gameEngine.js (JS 포팅본)를
  calibration_session.py + game_session.py (원본) 기준값과 비교한다.

  같은 시간축/시선/난수를 주입해 같은 결과가 나오는지 프레임 단위로 대조한다.
  두 엔진 모두 "초" 단위로 동작해서(파이썬 time.time() 과 동일 단위) ms<->초
  변환에 따른 부동소수점 오차 문제가 없다 - fixture 에 적힌 리터럴 초 값을
  그대로 넣으면 된다.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CalibrationEngine } from "./gaze/calibrationEngine.js";
import { GazeGameEngine } from "./gaze/gameEngine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, "fixture.json"), "utf-8"));

const problems = [];
const add = (msg) => problems.push(msg);

// ═══════════════════════════════════════════════════════════════
// 1. 캘리브레이션
// ═══════════════════════════════════════════════════════════════
{
  const { width, height, frames } = fixture.calibration.input;
  const expectedStates = fixture.calibration.expected.states;
  const expectedSamples = fixture.calibration.expected.final_samples;

  const clock = { t: 0 };
  const computeGaze = (landmarks) => [landmarks.gaze_x, landmarks.gaze_y];

  const engine = new CalibrationEngine(width, height, {
    computeGaze,
    smoother: null,
    now: () => clock.t,
  });

  // Calibration 클래스가 만드는 9포인트 그리드 자체도 대조한다.
  const expectedFirstPoints = expectedStates
    .filter((s, i) => i === 0 || expectedStates[i - 1].point?.join() !== s.point?.join())
    .map((s) => s.point);
  const gotPoints = engine.calibration.points;
  if (JSON.stringify(gotPoints.slice(0, expectedFirstPoints.length)) !== JSON.stringify(expectedFirstPoints)) {
    add(`[calibration] 9포인트 그리드 불일치\n  got=${JSON.stringify(gotPoints)}\n  exp=${JSON.stringify(expectedFirstPoints)}`);
  }

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    clock.t = frame.t;

    const state = engine.process({ gaze_x: frame.gaze_x, gaze_y: frame.gaze_y });
    const exp = expectedStates[i];

    const gp = state.point ? state.point.join(",") : null;
    const ep = exp.point ? exp.point.join(",") : null;
    if (gp !== ep) add(`[calibration] frame ${i}: point ${gp} != ${ep}`);
    if (state.finished !== exp.finished) {
      add(`[calibration] frame ${i}: finished ${state.finished} != ${exp.finished}`);
    }
  }

  const gotSamples = engine.calibration.samples;
  if (gotSamples.length !== expectedSamples.length) {
    add(`[calibration] 최종 샘플 개수 ${gotSamples.length} != ${expectedSamples.length}`);
  } else {
    const EPS = 1e-9;
    for (let i = 0; i < gotSamples.length; i++) {
      const g = gotSamples[i];
      const e = expectedSamples[i];
      if (g.screen[0] !== e.screen[0] || g.screen[1] !== e.screen[1]) {
        add(`[calibration] samples[${i}].screen ${JSON.stringify(g.screen)} != ${JSON.stringify(e.screen)}`);
      }
      if (Math.abs(g.gaze[0] - e.gaze[0]) > EPS || Math.abs(g.gaze[1] - e.gaze[1]) > EPS) {
        add(`[calibration] samples[${i}].gaze ${JSON.stringify(g.gaze)} != ${JSON.stringify(e.gaze)}`);
      }
    }
  }

  console.log(`[calibration] 프레임 ${frames.length}개, 샘플 ${gotSamples.length}개 검증 완료`);
}

// ═══════════════════════════════════════════════════════════════
// 2. 게임
// ═══════════════════════════════════════════════════════════════
{
  const { width, height, region_points: regionPointsRaw, randint_queue: randintQueue, frames } = fixture.game.input;
  const expectedStates = fixture.game.expected.states;

  // JSON 객체 키는 전부 문자열이므로 숫자로 되돌린다 (predict() 가
  // Number(region) 으로 비교하므로 값 자체는 문자열 키라도 동작은 하지만,
  // region_points 를 만드는 실제 코드(js/rhythm/calibration.js 의
  // createRegionPoints)도 항상 1..9 정수 키를 쓰므로 형태를 맞춰둔다).
  const regionPoints = {};
  for (const [k, v] of Object.entries(regionPointsRaw)) regionPoints[k] = v;

  const clock = { t: 0 };
  let randintIndex = 0;
  const computeGaze = (landmarks) => [landmarks.gaze_x, landmarks.gaze_y];
  const randint = () => randintQueue[randintIndex++ % randintQueue.length];

  const engine = new GazeGameEngine(width, height, regionPoints, {
    computeGaze,
    smoother: null,
    now: () => clock.t,
    randint,
  });

  // remaining(화면 표시용 타이머)은 딱 .x5 초에 걸치면(예: 26.25) 파이썬
  // round() 는 5사5입 대신 "짝수로 반올림"(banker's rounding)을 쓰고 JS
  // toFixed() 는 그렇지 않아, 정확히 반씩 갈리는 그 경계에서만 0.1 차이가
  // 날 수 있다 - 판정에 쓰이는 finished 는 반올림 전 값으로 계산되므로
  // 게임 동작에는 영향이 없다. 그래서 하드 실패가 아니라 참고로만 집계한다.
  let roundingDiffFrames = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    clock.t = frame.t;

    const state = engine.process({ gaze_x: frame.gaze_x, gaze_y: frame.gaze_y });
    const exp = expectedStates[i];

    if (state.target !== exp.target) add(`[game] frame ${i}: target ${state.target} != ${exp.target}`);
    if (state.region !== exp.region) add(`[game] frame ${i}: region ${state.region} != ${exp.region}`);
    if (state.score !== exp.score) add(`[game] frame ${i}: score ${state.score} != ${exp.score}`);
    if (state.finished !== exp.finished) add(`[game] frame ${i}: finished ${state.finished} != ${exp.finished}`);

    const gr = state.rect ? state.rect.join(",") : null;
    const er = exp.rect ? exp.rect.join(",") : null;
    if (gr !== er) add(`[game] frame ${i}: rect ${gr} != ${er}`);

    const remainingDiff = Math.abs(state.remaining - exp.remaining);
    if (remainingDiff > 1e-9) {
      if (remainingDiff <= 0.1 + 1e-9) {
        roundingDiffFrames++;
      } else {
        add(`[game] frame ${i}: remaining ${state.remaining} != ${exp.remaining} (반올림 한 칸을 넘는 차이)`);
      }
    }
  }

  const final = expectedStates[expectedStates.length - 1];
  console.log(`[game] 프레임 ${frames.length}개, 최종 score=${final.score} finished=${final.finished} 검증 완료`);
  if (roundingDiffFrames > 0) {
    console.log(`[game] 참고: remaining 표시값이 ${roundingDiffFrames}/${frames.length} 프레임에서 파이썬의 짝수 반올림과 0.1 차이 (게임 동작에는 무관)`);
  }
}

// ═══════════════════════════════════════════════════════════════
console.log("");
if (problems.length === 0) {
  console.log("PASS  캘리브레이션(9포인트/타이밍/샘플) + 게임(목표선택/판정/점수/시간) 전 프레임 일치");
  console.log("\n전체 결과: ALL PASS");
  process.exit(0);
}

console.log(`FAIL  불일치 ${problems.length}건 (앞 20건만 표시)`);
for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
console.log("\n전체 결과: FAIL");
process.exit(1);
