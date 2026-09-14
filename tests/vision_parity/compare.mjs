/*
  JS 포팅본을 파이썬 기준값(fixture.json)과 비교한다.
  vision/ 폴더는 실행 직전에 프로젝트에서 그대로 복사해온 것이다.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeGaze, GazeSmoother } from "./vision/gaze.js";
import { BlinkMonitor } from "./vision/blinkMonitor.js";
import { calculateRegionGaze, createRegionPoints } from "./vision/gazeRegionClassifier.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, "fixture.json"), "utf-8"));

const { frames, samples } = fixture.input;
const exp = fixture.expected;

let maxGazeDiff = 0;
let maxEarDiff = 0;
let blinkStateMismatch = 0;
let blinkCountMismatch = 0;

const smoother = new GazeSmoother(0.2);
const monitor = new BlinkMonitor();

for (let i = 0; i < frames.length; i++) {
  const lms = frames[i].map((p) => ({ x: p[0], y: p[1] }));

  const [gx, gy] = computeGaze(lms, smoother);
  maxGazeDiff = Math.max(maxGazeDiff, Math.abs(gx - exp.gaze[i][0]), Math.abs(gy - exp.gaze[i][1]));

  const b = monitor.update(lms);
  const [eEar, eLeft, eRight, eBlinking, eCount] = exp.blink[i];
  maxEarDiff = Math.max(
    maxEarDiff,
    Math.abs(b.ear - eEar),
    Math.abs(b.left_ear - eLeft),
    Math.abs(b.right_ear - eRight)
  );
  if (b.is_blinking !== eBlinking) blinkStateMismatch++;
  if (b.blink_count !== eCount) blinkCountMismatch++;
}

// 캘리브레이션 -> 영역 번호 -> 레인 x
const regionPoints = createRegionPoints(calculateRegionGaze(samples));

let maxRegionDiff = 0;
let regionKeyMismatch = 0;
const expKeys = Object.keys(exp.region_points).sort();
const gotKeys = Object.keys(regionPoints).sort();
if (expKeys.join(",") !== gotKeys.join(",")) regionKeyMismatch = 1;

for (const k of expKeys) {
  if (!regionPoints[k]) {
    regionKeyMismatch = 1;
    continue;
  }
  maxRegionDiff = Math.max(
    maxRegionDiff,
    Math.abs(regionPoints[k][0] - exp.region_points[k][0]),
    Math.abs(regionPoints[k][1] - exp.region_points[k][1])
  );
}

const laneX = {
  left: [1, 4, 7].reduce((s, r) => s + regionPoints[r][0], 0) / 3,
  center: [2, 5, 8].reduce((s, r) => s + regionPoints[r][0], 0) / 3,
  right: [3, 6, 9].reduce((s, r) => s + regionPoints[r][0], 0) / 3,
};

let maxLaneDiff = 0;
for (const k of ["left", "center", "right"]) {
  maxLaneDiff = Math.max(maxLaneDiff, Math.abs(laneX[k] - exp.lane_x[k]));
}

// ── 결과 ──────────────────────────────────────────────
const EPS = 1e-12;
const rows = [
  ["compute_gaze (200 프레임, EMA 상태 포함)", maxGazeDiff, maxGazeDiff <= EPS],
  ["EAR 값 (ear/left/right)", maxEarDiff, maxEarDiff <= EPS],
  ["region_points (9개 영역 좌표)", maxRegionDiff, maxRegionDiff <= EPS],
  ["lane_x (리듬게임 좌/중/우 기준값)", maxLaneDiff, maxLaneDiff <= EPS],
];

console.log("=== Python vs JS 수치 일치 검증 ===\n");
for (const [name, diff, ok] of rows) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  console.log(`      최대 절대오차: ${diff}`);
}

console.log("");
console.log(`${blinkStateMismatch === 0 ? "PASS" : "FAIL"}  is_blinking 상태 전이 (불일치 ${blinkStateMismatch}/${frames.length} 프레임)`);
console.log(`${blinkCountMismatch === 0 ? "PASS" : "FAIL"}  blink_count 누적 (불일치 ${blinkCountMismatch}/${frames.length} 프레임)`);
console.log(`${regionKeyMismatch === 0 ? "PASS" : "FAIL"}  region 번호 키 집합 일치`);
console.log(`\n참고: 최종 blink_count = ${monitor.blinkCount} (파이썬 ${exp.blink[exp.blink.length - 1][4]})`);
console.log(`참고: lane_x = ${JSON.stringify(laneX)}`);

const allOk =
  rows.every(([, , ok]) => ok) &&
  blinkStateMismatch === 0 &&
  blinkCountMismatch === 0 &&
  regionKeyMismatch === 0;

console.log(`\n전체 결과: ${allOk ? "ALL PASS" : "FAIL 있음"}`);
process.exit(allOk ? 0 : 1);
