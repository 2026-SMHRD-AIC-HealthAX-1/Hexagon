/*
  src/blink_monitor.py 의 JS 포팅.

  EAR(eye aspect ratio) = (세로거리1 + 세로거리2) / (2 * 가로거리).
  임계값(0.20) 아래로 양쪽 눈이 동시에 내려가면 "감은 상태"로 보고,
  뜬 상태 -> 감은 상태 전이를 깜빡임 시작으로 센다.

  리듬게임은 is_blinking 의 상승 엣지(false->true)만 쓰지만, 홈 화면 깜빡임
  모니터링을 나중에 옮길 때를 위해 blinkCount/durations/intervals 까지
  파이썬판 그대로 포팅해뒀다.

  ※ 시간 단위: 파이썬은 time.time()(초). JS는 performance.now()(밀리초)를
    1000으로 나눠 초 단위로 맞췄다 - durations/intervals 의 의미가 파이썬판과
    같아지도록 하기 위함.
  ※ 임계값 0.20 은 src/blink_monitor.py 와 반드시 같아야 한다. 한쪽만 바꾸면
    CLI 와 웹의 깜빡임 감지가 조용히 달라진다.
*/

const DEFAULT_THRESHOLD = 0.2;

// 파이썬판 update() 안에 하드코딩되어 있던 인덱스와 동일
const LEFT_EYE_EAR = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_EAR = [362, 385, 387, 263, 373, 380];

function distance(p1, p2) {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

function calculateEar(landmarks, eye) {
  const p1 = landmarks[eye[0]];
  const p2 = landmarks[eye[1]];
  const p3 = landmarks[eye[2]];
  const p4 = landmarks[eye[3]];
  const p5 = landmarks[eye[4]];
  const p6 = landmarks[eye[5]];

  const vertical1 = distance(p2, p6);
  const vertical2 = distance(p3, p5);
  const horizontal = distance(p1, p4);

  if (horizontal === 0) {
    return 0.0;
  }

  return (vertical1 + vertical2) / (2.0 * horizontal);
}

export class BlinkMonitor {
  constructor(threshold = DEFAULT_THRESHOLD) {
    this.threshold = threshold;

    this.leftClosed = false;
    this.rightClosed = false;

    this.isBlinking = false;
    this.blinkCount = 0;

    this.blinkStartTime = null;
    this.lastBlinkTime = null;

    this.blinkDurations = [];
    this.blinkIntervals = [];
  }

  /** 파이썬의 time.time() 과 같은 "초 단위 실수" 시각 */
  _now() {
    return performance.now() / 1000;
  }

  update(landmarks) {
    const leftEar = calculateEar(landmarks, LEFT_EYE_EAR);
    const rightEar = calculateEar(landmarks, RIGHT_EYE_EAR);

    const ear = (leftEar + rightEar) / 2.0;

    const leftClosed = leftEar < this.threshold;
    const rightClosed = rightEar < this.threshold;
    const eyesClosed = leftClosed && rightClosed;

    const now = this._now();

    if (eyesClosed && !this.isBlinking) {
      // 눈을 감기 시작
      this.isBlinking = true;
      this.blinkStartTime = now;
    } else if (!eyesClosed && this.isBlinking) {
      // 눈을 다시 뜸
      this.isBlinking = false;

      this.blinkDurations.push(now - this.blinkStartTime);

      if (this.lastBlinkTime !== null) {
        this.blinkIntervals.push(now - this.lastBlinkTime);
      }

      this.lastBlinkTime = now;
      this.blinkCount += 1;
    }

    this.leftClosed = leftClosed;
    this.rightClosed = rightClosed;

    return {
      ear,
      left_ear: leftEar,
      right_ear: rightEar,
      is_blinking: this.isBlinking,
      blink_count: this.blinkCount,
    };
  }
}
