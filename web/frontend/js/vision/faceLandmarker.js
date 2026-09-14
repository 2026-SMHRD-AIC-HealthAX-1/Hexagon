/*
  web/backend/landmarker_factory.py 의 JS 대응물.

  파이썬에서 mediapipe 패키지가 하던 일(FaceLandmarker 생성 + 프레임 처리)을
  브라우저에서 WASM 으로 수행한다.

  필요한 자산은 저장소에 없으므로 먼저 아래를 한 번 실행해야 한다:
      python scripts/setup_mediapipe.py
  (web/frontend/vendor/mediapipe/ 에 WASM 엔진과 모델이 놓인다)

  서버판과의 차이:
    - delegate: 서버는 CPU 고정. 여기서는 실시간 처리가 중요해 GPU 를 먼저
      시도하고, 실패하면 CPU 로 자동 폴백한다. GPU/CPU 는 연산 경로가 달라
      랜드마크 좌표가 마지막 자리에서 다를 수 있지만, 하위 로직이 임계값
      비교와 최근접 판정이라 판정 결과에는 영향이 없다.
    - 타임스탬프: 서버는 프레임마다 33ms 씩 고정 증가시켰지만, 여기서는 실제
      경과 시간을 쓴다. 단 detectForVideo 는 타임스탬프가 반드시 증가해야 하므로
      (같거나 작으면 예외) 단조 증가를 강제한다.
*/

const VENDOR_BASE = "vendor/mediapipe";

let visionModulePromise = null;

/** vision_bundle.mjs 를 한 번만 동적 import 한다. */
function loadVisionModule() {
  if (!visionModulePromise) {
    visionModulePromise = import(`/${VENDOR_BASE}/vision_bundle.mjs`);
  }
  return visionModulePromise;
}

/**
 * FaceLandmarker 를 만든다. 최초 호출 시 WASM(수십 MB)과 모델(3.6MB)을
 * 내려받으므로 수 초 걸릴 수 있다 - 호출부에서 로딩 표시를 해주는 게 좋다.
 */
export async function createFaceLandmarker() {
  const vision = await loadVisionModule();
  const { FilesetResolver, FaceLandmarker } = vision;

  const fileset = await FilesetResolver.forVisionTasks(`/${VENDOR_BASE}/wasm`);

  const options = {
    baseOptions: {
      modelAssetPath: `/${VENDOR_BASE}/face_landmarker.task`,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
  };

  try {
    return await FaceLandmarker.createFromOptions(fileset, options);
  } catch (err) {
    console.warn("[faceLandmarker] GPU delegate 실패, CPU 로 폴백합니다.", err);
    options.baseOptions.delegate = "CPU";
    return FaceLandmarker.createFromOptions(fileset, options);
  }
}

/**
 * <video> 프레임에서 얼굴 랜드마크를 뽑는다.
 * 얼굴이 없으면 null 을 돌려준다 - 서버 라우터들이
 * `if not result.face_landmarks: continue` 하던 것과 같은 의미.
 */
export function detectLandmarks(landmarker, video, timestampMs) {
  const result = landmarker.detectForVideo(video, timestampMs);

  if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
    return null;
  }

  // 파이썬판은 result.face_landmarks[0] 를 썼다 (numFaces=1).
  return result.faceLandmarks[0];
}

/**
 * detectForVideo 에 넘길 타임스탬프를 만든다.
 * MediaPipe 는 타임스탬프가 이전 값보다 반드시 커야 하므로, 같은 밀리초에
 * 두 번 호출되는 경우를 대비해 단조 증가를 보장한다.
 */
export function createTimestampSource() {
  let last = -1;

  return function next() {
    let now = Math.round(performance.now());
    if (now <= last) {
      now = last + 1;
    }
    last = now;
    return now;
  };
}
