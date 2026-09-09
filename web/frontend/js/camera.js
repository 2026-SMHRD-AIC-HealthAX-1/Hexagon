export function startFrameSender(video, ws, options = {}) {
  const fps = options.fps || 10;
  const quality = options.quality || 0.7;
  const maxWidth = options.maxWidth || 640;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const intervalMs = 1000 / fps;

  const timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (!video.videoWidth) return;

    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (blob && ws.readyState === WebSocket.OPEN) {
          ws.send(blob);
        }
      },
      "image/jpeg",
      quality
    );
  }, intervalMs);

  return () => clearInterval(timer);
}

// 눈 깜빡임 모니터링 전용 - MediaStreamTrackProcessor(Insertable Streams)로 캡처를
// blink_capture_worker.js 안에서 돌려서, 탭이 hidden 상태여도 메인 스레드
// setInterval/requestAnimationFrame 스로틀링의 영향을 받지 않게 한다. 크로미움
// 계열 브라우저 전용 API라 미지원 브라우저(Firefox/Safari 등)에서는 null을
// 반환하니, 호출부는 null이면 startFrameSender + 메인 스레드 WebSocket으로
// 폴백해야 한다. 시선추적 게임/리듬게임은 사용자가 화면을 보며 플레이해야 하므로
// 이 함수 대상이 아니고, 기존 startFrameSender는 그대로 둔다.
export function startWorkerFrameSender(stream, wsPath, options, onEvent) {
  if (!("MediaStreamTrackProcessor" in window)) return null;

  const track = stream.getVideoTracks()[0];
  if (!track) return null;

  const processor = new MediaStreamTrackProcessor({ track });
  const readable = processor.readable;

  const worker = new Worker(new URL("./blink_capture_worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => onEvent(event.data);

  worker.postMessage(
    {
      type: "start",
      readable,
      wsUrl: wsUrl(wsPath),
      fps: options.fps || 8,
      quality: options.quality || 0.7,
      maxWidth: options.maxWidth || 640,
    },
    [readable]
  );

  return () => {
    worker.postMessage({ type: "stop" });
    setTimeout(() => worker.terminate(), 300);
  };
}

export function wsUrl(path) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}${path}`;
}
