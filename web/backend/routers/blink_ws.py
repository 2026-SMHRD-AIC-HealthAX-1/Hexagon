import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from landmarker_factory import create_landmarker
from frame_utils import decode_frame
from sessions.blink_session import BlinkSession

router = APIRouter()


@router.websocket("/ws/blink")
async def blink_ws(websocket: WebSocket):
    await websocket.accept()

    session = BlinkSession()
    frame_timestamp_ms = 0
    loop = asyncio.get_running_loop()

    # Dedicated single thread per connection: keeps this connection's
    # MediaPipe calls off the shared asyncio event loop (so one connection's
    # inference can't block another's), while still landing every call for
    # this landmarker on the same thread throughout its lifetime.
    executor = ThreadPoolExecutor(max_workers=1)
    landmarker = await loop.run_in_executor(executor, create_landmarker)

    try:
        try:
            while True:
                message = await websocket.receive()

                if message["type"] == "websocket.disconnect":
                    return

                if "bytes" not in message or message["bytes"] is None:
                    continue

                mp_image = decode_frame(message["bytes"])
                if mp_image is None:
                    continue

                result = await loop.run_in_executor(
                    executor, landmarker.detect_for_video, mp_image, frame_timestamp_ms
                )
                frame_timestamp_ms += 33

                if not result.face_landmarks:
                    continue

                state = session.process(result.face_landmarks[0])
                await websocket.send_json(state)

        except WebSocketDisconnect:
            return
    finally:
        await loop.run_in_executor(executor, landmarker.close)
        executor.shutdown(wait=False)

    await websocket.close()
