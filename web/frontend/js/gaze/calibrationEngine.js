/*
  src/calibration.py 의 JS 포팅 (9포인트 그리드 + 샘플 수집 타이밍).

  대응 관계:
      Calibration(width, height)  -> new Calibration(width, height, now)
      calibration_session.py 의 CalibrationSession.process() 타이밍 로직
      (0.3~2.8s 구간 샘플 수집, 3.0s 에 다음 포인트) -> CalibrationEngine.process()

  DB 저장(db.save_calibration)은 여기서 하지 않는다 - 서버판은 완료 시
  세션이 직접 DB에 썼지만, 여기서는 계산이 브라우저에서 끝나므로 호출부가
  calibrationApi.js 의 saveCalibration() 을 별도로 호출해 HTTP 로 넘긴다.

  computeGaze/smoother 는 (js/rhythm/gameEngine.js 와 마찬가지로) vision/gaze.js
  를 직접 import 하지 않고 deps 로 주입받는다 - 판정 로직을 시선 계산과
  분리해두면 순수 로직만 결정론적으로 재현할 수 있다(원래 이 방식으로
  tests/gaze_parity 가 검증했으나, 그 테스트는 두더지 사냥 리워크 이후
  gaze/gameEngine.js 와 함께 2026-09-18에 삭제됐다 - 오늘은 이 주입점을
  쓰는 자동화 테스트가 없지만, game.js/rhythm_game.js 양쪽이 이 클래스를
  그대로 재사용하므로 구조는 유지한다).
  now 역시 같은 이유의 주입점이며, 실제 실행에서는 performance.now()/1000
  (Python time.time() 과 같은 "초" 단위)을 기본값으로 쓴다.
*/

const SAMPLE_WINDOW_START_SEC = 0.3;
const SAMPLE_WINDOW_END_SEC = 2.8;
const POINT_ADVANCE_SEC = 3.0;

export class Calibration {
  constructor(width, height, now) {
    this.width = width;
    this.height = height;
    this.now = now;

    // int(width * 0.03) 과 동일 (양수라 Math.trunc == 원래 truncation).
    const marginX = Math.trunc(width * 0.03);
    const marginY = Math.trunc(height * 0.03);
    const halfW = Math.floor(width / 2);
    const halfH = Math.floor(height / 2);

    this.points = [
      [marginX, marginY], [halfW, marginY], [width - marginX, marginY],
      [marginX, halfH], [halfW, halfH], [width - marginX, halfH],
      [marginX, height - marginY], [halfW, height - marginY], [width - marginX, height - marginY],
    ];

    this.currentIndex = 0;
    this.samples = [];
    this.startTime = null;
  }

  start() {
    this.currentIndex = 0;
    this.samples = [];
    this.startTime = this.now();
  }

  currentPoint() {
    if (this.currentIndex >= this.points.length) return null;
    return this.points[this.currentIndex];
  }

  addSample(gazeX, gazeY) {
    const point = this.currentPoint();
    if (!point) return;
    this.samples.push({ screen: point, gaze: [gazeX, gazeY] });
  }

  nextPoint() {
    this.currentIndex += 1;
    this.startTime = this.now();
  }

  isFinished() {
    return this.currentIndex >= this.points.length;
  }
}

/**
 * web/backend/sessions/calibration_session.py 의 CalibrationSession.process() 대응.
 *
 * @param {{computeGaze:Function, smoother:object, now?:Function}} deps
 *   computeGaze/smoother 는 필수 - 실제 실행에서는 호출부(js/game.js)가
 *   vision/gaze.js 의 computeGaze 와 new GazeSmoother(0.2) 를 넘긴다.
 *   now 는 결정론적 테스트를 위한 주입점(현재는 이를 실제로 쓰는 테스트가 없음),
 *   기본값은 performance.now()/1000.
 */
export class CalibrationEngine {
  constructor(width, height, deps) {
    this.now = deps.now || (() => performance.now() / 1000);
    this.calibration = new Calibration(width, height, this.now);
    this.calibration.start();
    this.computeGaze = deps.computeGaze;
    this.smoother = deps.smoother;
  }

  process(faceLandmarks) {
    const [gazeX, gazeY] = this.computeGaze(faceLandmarks, this.smoother);

    const point = this.calibration.currentPoint();

    if (point) {
      const elapsed = this.now() - this.calibration.startTime;

      if (elapsed >= SAMPLE_WINDOW_START_SEC && elapsed < SAMPLE_WINDOW_END_SEC) {
        this.calibration.addSample(gazeX, gazeY);
      }
      if (elapsed >= POINT_ADVANCE_SEC) {
        this.calibration.nextPoint();
      }
    }

    const finished = this.calibration.isFinished();

    return { point, finished };
  }
}
