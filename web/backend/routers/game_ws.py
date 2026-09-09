import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from landmarker_factory import create_landmarker
from frame_utils import decode_frame
from sessions.game_session import GameSession, CalibrationNotFoundError

router = APIRouter()


@router.websocket("/ws/game")
async def game_ws(websocket: WebSocket):
    await websocket.accept()

    user_id = websocket.session.get("user_id")
    if user_id is None:
        await websocket.send_json({"type": "error", "message": "로그인이 필요합니다."})
        await websocket.close()
        return

    init = await websocket.receive_json()

    try:
        session = GameSession(int(init["width"]), int(init["height"]), user_id)
    except CalibrationNotFoundError:
        await websocket.send_json({
            "type": "error",
            "message": "calibration data not found",
        })
        await websocket.close()
        return

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

                if state["finished"]:
                    break

        except WebSocketDisconnect:
            return
    finally:
        await loop.run_in_executor(executor, landmarker.close)
        executor.shutdown(wait=False)

    await websocket.close()
