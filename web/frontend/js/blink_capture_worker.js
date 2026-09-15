/*
  눈 깜빡임 모니터링 전용 캡처 워커.

  MediaStreamTrackProcessor로 받은 VideoFrame을 ImageBitmap으로 변환해
  메인 스레드로 전달하기만 한다 - 탭이 hidden 상태여도 캡처가 끊기지
  않게 하기 위해서다 (camera.js의 startWorkerFrameCapture에서 생성됨).

  MediaPipe(FaceLandmarker) 추론은 여기서 하지 않고 메인 스레드에서 한다.
  처음에는 이 워커 안에서 직접 추론까지 하도록 만들었는데, 실제 브라우저
  테스트(fake camera + Playwright)에서 GPU/CPU 델리게이트 둘 다
  "ModuleFactory not set" 에러로 실패했다 - MediaPipe의 WASM 로더가
  내부적으로 importScripts() 나 document.createElement("script") 로 글루
  코드를 불러오는데, 모듈 워커(type:"module")에는 importScripts가 없고
  document도 없어서 두 경로 다 막힌다. vision_bundle.mjs 자체는 export
  구문이 있는 ES 모듈이라 importScripts()로도 못 불러온다 - 즉 지금
  벤더 버전은 워커 안에서 자체적으로 로드될 수 없다.

  대신 "캡처는 워커, 추론은 메인 스레드"로 나눴다: 워커→메인스레드
  postMessage 전달은 타이머가 아니라서 탭이 숨겨져도 setInterval/
  requestAnimationFrame 처럼 스로틀링되지 않는다 - 그래서 이 구조로도
  백그라운드 생존 목적은 그대로 유지된다(캡처가 끊기지 않으면 메인
  스레드는 메시지가 올 때마다 즉시 처리하면 됨).
*/

let stopped = false;
let reader = null;

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "start") {
    start(msg);
  } else if (msg.type === "stop") {
    stopped = true;
    if (reader) reader.cancel().catch(() => {});
  }
};

async function start({ readable, fps, maxWidth }) {
  const intervalMs = 1000 / fps;
  let lastSent = 0;

  reader = readable.getReader();
  self.postMessage({ type: "open" });

  while (!stopped) {
    const { value: frame, done } = await reader.read();
    if (done) break;

    const now = performance.now();
    if (now - lastSent < intervalMs) {
      // 목표 fps보다 빠르게 들어온 프레임은 버린다 - 처리 여부와 무관하게
      // 반드시 close()해야 미해제 VideoFrame 한도에 걸려 파이프라인이 멈추지 않는다.
      frame.close();
      continue;
    }
    lastSent = now;

    let bitmap;
    try {
      const scale = Math.min(1, maxWidth / frame.displayWidth);
      const width = Math.max(1, Math.round(frame.displayWidth * scale));
      const height = Math.max(1, Math.round(frame.displayHeight * scale));
      bitmap = await createImageBitmap(frame, { resizeWidth: width, resizeHeight: height });
    } catch (err) {
      frame.close();
      continue;
    }
    frame.close();

    // bitmap은 transferable - 메인 스레드가 다 쓰고 나면 close()해야 한다.
    self.postMessage({ type: "frame", bitmap }, [bitmap]);
  }

  self.postMessage({ type: "close" });
}
