/*
  src/gaze_game.py 의 JS 포팅 (3x3 영역 중 목표를 응시해서 맞추는 게임).

  대응 관계:
      GazeGame                                  -> GazeGame
      web/backend/sessions/game_session.py 의
      GameSession.process()                     -> GazeGameEngine.process()

  computeGaze/smoother 는 (js/rhythm/gameEngine.js 와 마찬가지로) vision/gaze.js
  를 직접 import 하지 않고 deps 로 주입받는다 - 판정 로직을 시선 계산과
  분리해두면 tests/gaze_parity 에서 순수 로직만 결정론적으로 재현할 수 있다.
  now/randint 도 같은 이유의 주입점이고, 실제 실행에서는 performance.now()/1000,
  Math.random() 기반 기본값을 쓴다.
  remaining 값은 Python round(x, 1) 과 JS Math.round 가 이진/십진 반올림이
  달라 어긋날 수 있어(리듬게임 포팅 때 실제로 겪은 문제) toFixed 로 맞춘다.

  GazeRegionClassifier 만은 예외로 직접 import 한다 - 이건 시선 계산이
  아니라 순수 판정 로직(가장 가까운 영역 찾기)이라 gaze_game.py 의 일부처럼
  다뤄도 되고, 이미 tests/vision_parity 에서 별도로 검증돼 있다.
*/

import { GazeRegionClassifier } from "../vision/gazeRegionClassifier.js";

export const GAME_TIME_LIMIT_SEC = 30;
const REQUIRED_GAZE_TIME_SEC = 0.5;

function roundTo1(value) {
  return Number(value.toFixed(1));
}

function defaultRandint(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

export class GazeGame {
  constructor(width, height, deps) {
    this.width = width;
    this.height = height;
    this.regionWidth = Math.floor(width / 3);
    this.regionHeight = Math.floor(height / 3);

    this.currentTarget = null;
    this.gazeStartTime = null;
    this.requiredGazeTime = REQUIRED_GAZE_TIME_SEC;
    this.score = 0;
    this.timeLimit = GAME_TIME_LIMIT_SEC;

    this.now = deps.now ?? (() => performance.now() / 1000);
    this.randint = deps.randint ?? defaultRandint;

    this.startTime = this.now();
  }

  nextTarget() {
    if (this.currentTarget === null) {
      this.currentTarget = this.randint(1, 9);
    } else {
      const previous = this.currentTarget;
      let target;
      do {
        target = this.randint(1, 9);
      } while (target === previous);
      this.currentTarget = target;
    }
    return this.currentTarget;
  }

  getTargetRect() {
    if (this.currentTarget === null) return null;

    const target = this.currentTarget - 1;
    const row = Math.floor(target / 3);
    const col = target % 3;

    const x1 = Math.floor(col * this.regionWidth);
    const y1 = Math.floor(row * this.regionHeight);
    const x2 = Math.floor((col + 1) * this.regionWidth);
    const y2 = Math.floor((row + 1) * this.regionHeight);

    return [x1, y1, x2, y2];
  }

  isFinished() {
    return this.now() - this.startTime >= this.timeLimit;
  }

  checkGaze(gazeRegion) {
    if (this.currentTarget === null) return false;

    if (gazeRegion === this.currentTarget) {
      if (this.gazeStartTime === null) {
        this.gazeStartTime = this.now();
      }
      const elapsed = this.now() - this.gazeStartTime;
      if (elapsed >= this.requiredGazeTime) {
        return true;
      }
    } else {
      this.gazeStartTime = null;
    }

    return false;
  }

  handleSuccess() {
    this.score += 1;
    this.nextTarget();
    this.gazeStartTime = null;
  }
}

/**
 * web/backend/sessions/game_session.py 의 GameSession.process() 대응.
 *
 * @param {{computeGaze:Function, smoother:object, now?:Function, randint?:Function}} deps
 *   computeGaze/smoother 는 필수 - 실제 실행에서는 호출부(js/game.js)가
 *   vision/gaze.js 의 computeGaze 와 new GazeSmoother(0.2) 를 넘긴다.
 */
export class GazeGameEngine {
  constructor(width, height, regionPoints, deps) {
    this.classifier = new GazeRegionClassifier(regionPoints);
    this.game = new GazeGame(width, height, deps);
    this.game.nextTarget();
    this.computeGaze = deps.computeGaze;
    this.smoother = deps.smoother;
  }

  process(faceLandmarks) {
    const [gazeX, gazeY] = this.computeGaze(faceLandmarks, this.smoother);
    const gazeRegion = this.classifier.predict(gazeX, gazeY);

    if (this.game.checkGaze(gazeRegion)) {
      this.game.handleSuccess();
    }

    const finished = this.game.isFinished();
    const remaining = Math.max(0, this.game.timeLimit - (this.game.now() - this.game.startTime));
    const rect = this.game.getTargetRect();

    return {
      target: this.game.currentTarget,
      rect,
      region: gazeRegion,
      score: this.game.score,
      remaining: roundTo1(remaining),
      finished,
    };
  }
}
