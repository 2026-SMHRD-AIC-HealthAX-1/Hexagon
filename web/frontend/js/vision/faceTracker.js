/*
  눈 깜빡임 모니터링(home.js)이 카메라 앞 여러 사람 중 "모니터링을 시작한
  사람"만 계속 추적하도록 돕는 가벼운 위치 기반 추적기.

  MediaPipe FaceLandmarker는 numFaces: 1로 프레임마다 얼굴을 하나만
  돌려주지만(vision/faceLandmarker.js 참고), 그 얼굴이 매번 "같은 사람"이라는
  보장은 없다 - 여러 명이 화면에 있으면 프레임마다 더 크게/가깝게 잡히는
  얼굴로 검출 대상이 슬쩍 바뀔 수 있다. 진짜 신원 확인(얼굴 인식/임베딩
  비교)을 붙이려면 별도 모델과 사용자별 기준 얼굴 데이터 저장이 필요해서
  범위가 커지므로, 대신 "직전에 추적하던 얼굴과 화면상 위치가 겹치는가"만
  프레임마다 확인하는 방식을 쓴다 - 추가 추론 없이 이미 계산된 랜드마크
  좌표의 min/max와 사각형 겹침(IoU) 비율만 계산하므로 비용이 거의 없다.

  동작:
    1. 모니터링을 시작해서 처음 잡힌 얼굴을 기준 위치로 삼는다.
    2. 다음 프레임부터는 새로 잡힌 얼굴의 바운딩박스가 기준 위치와
       iouThreshold 이상 겹칠 때만 "같은 사람"으로 보고 깜빡임 판정에 쓴다.
       겹치면 자연스러운 움직임을 따라가도록 기준 위치도 그 프레임으로 갱신한다.
    3. 겹치지 않는 프레임(다른 사람 얼굴, 또는 얼굴이 아예 안 잡힘)이
       maxMissedFrames를 넘도록 이어지면 - 원래 사람이 자리를 떴다고 보고
       그 시점에 보이는 얼굴을 새 기준으로 다시 잡는다(1번과 동일).

  한계: 위치가 우연히 겹치면(예: 원래 사용자가 일어나자마자 다른 사람이 거의
  같은 자리에 앉는 경우) 다른 사람으로 속을 수 있다 - 진짜 신원 구분이
  아니라 "직전 위치 연속성"만 보는 방식이라는 점은 의도적으로 받아들인
  트레이드오프다. 자세한 내용은 monitoring.txt 참고.
*/

const DEFAULT_IOU_THRESHOLD = 0.3;
// home.js의 캡처가 8fps(LOCAL_DETECT_INTERVAL_MS/startWorkerFrameCapture 둘 다
// 8fps)라, 20프레임이면 대략 2.5초 - 잠깐 고개를 돌리거나 얼굴 검출이
// 흔들리는 정도는 봐주면서도, 사람이 실제로 바뀌면 너무 오래 걸리지 않게
// 다시 잠그는 값으로 골랐다.
const DEFAULT_MAX_MISSED_FRAMES = 20;

function boundingBoxOf(landmarks) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const { x, y } of landmarks) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return { minX, minY, maxX, maxY };
}

function iou(a, b) {
  const interMinX = Math.max(a.minX, b.minX);
  const interMinY = Math.max(a.minY, b.minY);
  const interMaxX = Math.min(a.maxX, b.maxX);
  const interMaxY = Math.min(a.maxY, b.maxY);

  const interWidth = Math.max(0, interMaxX - interMinX);
  const interHeight = Math.max(0, interMaxY - interMinY);
  const interArea = interWidth * interHeight;

  const areaA = (a.maxX - a.minX) * (a.maxY - a.minY);
  const areaB = (b.maxX - b.minX) * (b.maxY - b.minY);
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

export class FaceTracker {
  constructor({ iouThreshold = DEFAULT_IOU_THRESHOLD, maxMissedFrames = DEFAULT_MAX_MISSED_FRAMES } = {}) {
    this.iouThreshold = iouThreshold;
    this.maxMissedFrames = maxMissedFrames;
    this.box = null;
    this.missedFrames = 0;
  }

  /**
   * landmarks: 이번 프레임에 검출된 얼굴 랜드마크, 또는 얼굴이 안 잡혔으면 null.
   * 반환값이 true일 때만 이번 프레임을 "추적 중인 사람"으로 보고 깜빡임
   * 판정(blinkMonitor.update)에 넘기면 된다.
   */
  update(landmarks) {
    if (!landmarks) {
      this.missedFrames += 1;
      return false;
    }

    const box = boundingBoxOf(landmarks);

    if (!this.box || iou(box, this.box) >= this.iouThreshold) {
      this.box = box;
      this.missedFrames = 0;
      return true;
    }

    this.missedFrames += 1;

    if (this.missedFrames > this.maxMissedFrames) {
      // 원래 추적하던 얼굴이 한동안 안 보였다 - 지금 보이는 얼굴을 새 기준으로 다시 잠근다.
      this.box = box;
      this.missedFrames = 0;
      return true;
    }

    return false;
  }
}
