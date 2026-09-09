from fastapi import APIRouter, Depends
from pydantic import BaseModel

import db
from routers.auth import get_current_user_id

router = APIRouter()


class GameResultRequest(BaseModel):
    score: int
    game_type: str = db.GAME_TYPE_GAZE


@router.post("/api/game-result")
async def post_game_result(request: GameResultRequest, user_id: int = Depends(get_current_user_id)):
    db.insert_game_record(user_id, request.score, request.game_type)
    return {"ok": True}


@router.post("/api/blink-alert")
async def post_blink_alert(user_id: int = Depends(get_current_user_id)):
    # home.js의 showBlinkAlert()가 눈 깜빡임 경고를 띄우는 매 순간 호출한다 -
    # 원본 깜빡임 데이터가 아니라 "경고가 발생한 시각"만 기록한다.
    db.log_blink_alert(user_id)
    return {"ok": True}


def _serialize_game_record(record):
    return {"score": record["score"], "played_at": record["played_at"]} if record else None


@router.get("/api/mypage")
async def get_mypage(user_id: int = Depends(get_current_user_id)):
    user = db.get_user(user_id)
    last_gaze_game = db.get_last_game_record(user_id, db.GAME_TYPE_GAZE)
    last_rhythm_game = db.get_last_game_record(user_id, db.GAME_TYPE_RHYTHM)

    # 백내장 위험도/안구 충혈도: S-03 사진 분석에 아직 실제 모델이 없어
    # analysis_results에 아무것도 쓰이지 않으므로 항상 null - 프론트가 "측정 기록 없음"으로 표시한다.
    return {
        "logged_in_at": user["last_login_at"] if user else None,
        "last_game_gaze": _serialize_game_record(last_gaze_game),
        "last_game_rhythm": _serialize_game_record(last_rhythm_game),
        "cataract_risk": None,
        "redness": None,
    }
