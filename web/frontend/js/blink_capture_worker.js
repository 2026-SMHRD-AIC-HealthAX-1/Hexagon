// 눈 깜빡임 모니터링 전용 캡처 워커. MediaStreamTrackProcessor로 전달받은
// VideoFrame을 메인 스레드를 거치지 않고 이 워커 안에서 바로 JPEG로 인코딩해서
// 자체 WebSocket으로 전송한다 - 탭이 hidden 상태여도 메인 스레드 타이머
// 스로틀링의 영향을 받지 않기 위함 (camera.js의 startWorkerFrameSender에서 생성됨).

let stopped = false;
let ws = null;
let reader = null;

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "start") {
    start(msg);
  } else if (msg.type === "stop") {
    stopped = true;
    if (reader) reader.cancel().catch(() => {});
    if (ws) ws.close();
  }
};

async function start({ readable, wsUrl, fps, quality, maxWidth }) {
  ws = new WebSocket(wsUrl);
  ws.onopen = () => self.postMessage({ type: "open" });
  ws.onmessage = (e) => self.postMessage({ type: "message", data: e.data });
  ws.onclose = () => self.postMessage({ type: "close" });
  ws.onerror = () => self.postMessage({ type: "error" });

  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d");
  const intervalMs = 1000 / fps;
  let lastSent = 0;

  reader = readable.getReader();

  while (!stopped) {
    const { value: frame, done } = await reader.read();
    if (done) break;

    const now = performance.now();
    if (now - lastSent < intervalMs) {
      // 목표 fps보다 빠르게 들어온 프레임은 그냥 버린다 - 전송 여부와 무관하게
      // 반드시 close()해야 미해제 VideoFrame 한도에 걸려 파이프라인이 멈추지 않는다.
      frame.close();
      continue;
    }
    lastSent = now;

    const scale = Math.min(1, maxWidth / frame.displayWidth);
    canvas.width = Math.round(frame.displayWidth * scale);
    canvas.height = Math.round(frame.displayHeight * scale);
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    frame.close();

    if (ws.readyState === WebSocket.OPEN) {
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      if (ws.readyState === WebSocket.OPEN) ws.send(blob);
    }
  }

  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
}
