"""
캘리브레이션 데이터를 브라우저와 주고받는 HTTP 엔드포인트.

왜 필요한가:
    지금까지 캘리브레이션 데이터는 서버 안에서만 읽고 썼다 - calibration_ws.py
    가 WebSocket 안에서 직접 계산해 db에 저장하고, game_ws.py / rhythm_game_ws.py
    가 다시 db를 조회해 시선 판정까지 끝냈기 때문이다. 계산을 브라우저(JS)로
    옮기면 그 계산 자체가 브라우저 안에서 끝나므로, 결과를 읽고 쓰는 HTTP
    엔드포인트가 따로 필요하다.

    기존 WebSocket 경로(calibration_ws.py, game_ws.py, rhythm_game_ws.py)는
    전혀 바뀌지 않는다 - 순수하게 추가되는 엔드포인트다.

보안:
    다른 보호된 엔드포인트와 동일하게 세션 쿠키로 사용자를 식별한다
    (get_current_user_id). 로그인하지 않았으면 401 이고, 남의 캘리브레이션을
    읽거나 덮어쓸 방법은 없다 - user_id 를 클라이언트가 지정할 수 없기 때문.
"""
from fastapi import APIRouter, Body, Depends

import db
from routers.auth import get_current_user_id

router = APIRouter()


@router.get("/api/calibration")
async def get_calibration(user_id: int = Depends(get_current_user_id)):
    """
    로그인한 사용자의 캘리브레이션 샘플을 돌려준다.

    samples 의 모양은 서버 내부에서 쓰던 것과 동일하다:
        [{"screen": [x, y], "gaze": [gx, gy]}, ...]
    브라우저는 이걸 js/vision/gazeRegionClassifier.js 에 그대로 넣어
    영역 좌표(1~9)를 계산한다 - 파이썬판과 같은 결과가 나오는지는
    tests/vision_parity 에서 검증한다.
    """
    if not db.has_calibration(user_id):
        return {"has_calibration": False, "samples": []}

    return {
        "has_calibration": True,
        "samples": db.get_calibration_samples(user_id),
    }


@router.post("/api/calibration")
async def save_calibration(payload: dict = Body(...), user_id: int = Depends(get_current_user_id)):
    """
    브라우저(js/gaze/calibrationEngine.js)가 끝낸 캘리브레이션 결과를 저장한다.

    calibration_session.py 의 CalibrationSession.process() 가 완료 시
    db.save_calibration() 을 직접 호출하던 것과 같은 일을, 계산이 브라우저에서
    끝나므로 여기서 대신 한다. samples 모양은 저장/조회 모두와 동일하다:
        [{"screen": [x, y], "gaze": [gx, gy]}, ...]
    """
    db.save_calibration(
        user_id,
        int(payload["width"]),
        int(payload["height"]),
        payload["samples"],
    )
    return {"ok": True}
