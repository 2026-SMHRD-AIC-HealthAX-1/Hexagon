/*
  src/gaze.py 의 JS 포팅.

  눈 bounding box -> 홍채 중심 -> 0~1 정규화 -> 좌우 평균 -> EMA 스무딩.
  전부 순수 산술이라 파이썬판과 동일한 입력에 동일한 출력이 나와야 한다
  (AI 없음, 상태는 GazeSmoother 의 EMA 뿐).

  ※ 합산 순서까지 파이썬과 맞춰놨다. 부동소수점 덧셈은 순서에 따라 마지막
    자리가 달라질 수 있어서, 수치 일치 검증을 통과시키려면 순서를 지켜야 한다.
*/

import { RIGHT_EYE, RIGHT_IRIS, LEFT_EYE, LEFT_IRIS } from "./landmarks.js";

export function getLandmarkXY(faceLandmarks, index) {
  const landmark = faceLandmarks[index];
  return [landmark.x, landmark.y];
}

export function getEyeBounds(faceLandmarks, eyeIndices) {
  const xs = [];
  const ys = [];

  for (const index of eyeIndices) {
    const [x, y] = getLandmarkXY(faceLandmarks, index);
    xs.push(x);
    ys.push(y);
  }

  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
}

export function getIrisCenter(faceLandmarks, irisIndices) {
  const xs = [];
  const ys = [];

  for (const index of irisIndices) {
    const [x, y] = getLandmarkXY(faceLandmarks, index);
    xs.push(x);
    ys.push(y);
  }

  let sumX = 0;
  let sumY = 0;
  for (const x of xs) sumX += x;
  for (const y of ys) sumY += y;

  return [sumX / xs.length, sumY / ys.length];
}

export function normalizeIrisPosition(irisX, irisY, eyeBounds) {
  const [eyeLeft, eyeRight, eyeTop, eyeBottom] = eyeBounds;

  const eyeWidth = eyeRight - eyeLeft;
  const eyeHeight = eyeBottom - eyeTop;

  if (eyeWidth === 0 || eyeHeight === 0) {
    return [0.5, 0.5];
  }

  return [(irisX - eyeLeft) / eyeWidth, (irisY - eyeTop) / eyeHeight];
}

export class GazeSmoother {
  constructor(alpha = 0.2) {
    this.alpha = alpha;
    this.x = null;
    this.y = null;
  }

  update(x, y) {
    if (this.x === null) {
      this.x = x;
      this.y = y;
    } else {
      this.x = this.alpha * x + (1 - this.alpha) * this.x;
      this.y = this.alpha * y + (1 - this.alpha) * this.y;
    }

    return [this.x, this.y];
  }
}

export function computeGaze(faceLandmarks, smoother) {
  const rightEyeBounds = getEyeBounds(faceLandmarks, RIGHT_EYE);
  const leftEyeBounds = getEyeBounds(faceLandmarks, LEFT_EYE);

  const [rightIrisX, rightIrisY] = getIrisCenter(faceLandmarks, RIGHT_IRIS);
  const [leftIrisX, leftIrisY] = getIrisCenter(faceLandmarks, LEFT_IRIS);

  const [rightGazeX, rightGazeY] = normalizeIrisPosition(rightIrisX, rightIrisY, rightEyeBounds);
  const [leftGazeX, leftGazeY] = normalizeIrisPosition(leftIrisX, leftIrisY, leftEyeBounds);

  const gazeX = (rightGazeX + leftGazeX) / 2;
  const gazeY = (rightGazeY + leftGazeY) / 2;

  return smoother.update(gazeX, gazeY);
}
