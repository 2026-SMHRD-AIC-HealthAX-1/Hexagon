from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
# 경계값의 단일 기준인 models/cataract_cls/infer.py의 함수 - 그 폴더는 sys.path에
# 없고 eye_analysis가 자기 import 시점에 넣어주므로 파이프라인 쪽에서 가져온다.
from eye_analysis import classify_risk
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


@router.delete("/api/analysis-results")
async def delete_analysis_results(user_id: int = Depends(get_current_user_id)):
    # 마이페이지의 "백내장·충혈도 측정 기록 삭제" 버튼 - 해당 사용자 것만 지운다
    # (session에서 나온 user_id로 WHERE 절이 걸리므로 다른 사용자 데이터는 손댈 수 없음).
    db.delete_analysis_results(user_id)
    return {"ok": True}


@router.delete("/api/game-records/gaze")
async def delete_gaze_game_records(user_id: int = Depends(get_current_user_id)):
    # 마이페이지의 "시선 추적 게임 기록 삭제" 버튼 - 리듬게임 기록은 건드리지 않는다.
    db.delete_game_records(user_id, db.GAME_TYPE_GAZE)
    return {"ok": True}


def _serialize_game_record(record):
    return {"score": record["score"], "played_at": record["played_at"]} if record else None


def _serialize_cataract_risk(analysis):
    if not analysis:
        return None
    return {
        "prob": analysis["cataract_prob"],
        "label": classify_risk(analysis["cataract_prob"]),
        "analyzed_at": analysis["analyzed_at"],
    }


def _serialize_redness(analysis):
    if not analysis:
        return None
    return {"ratio": analysis["redness_ratio"], "analyzed_at": analysis["analyzed_at"]}


@router.get("/api/mypage")
async def get_mypage(user_id: int = Depends(get_current_user_id)):
    user = db.get_user(user_id)
    last_gaze_game = db.get_last_game_record(user_id, db.GAME_TYPE_GAZE)
    last_rhythm_game = db.get_last_game_record(user_id, db.GAME_TYPE_RHYTHM)
    last_analysis = db.get_last_analysis_result(user_id)

    # 백내장 위험도/안구 충혈도: S-03 사진 분석(routers/analysis.py)을 한 번도
    # 하지 않았으면 둘 다 null이고, 프론트가 "측정 미완료"로 표시한다.
    # 등급(정상/주의 필요/위험)은 저장된 값이 아니라 확률에서 그때그때 계산한다 -
    # 경계값의 단일 기준은 models/cataract_cls/infer.py다 (db.py 스키마 주석 참고).
    return {
        "logged_in_at": user["last_login_at"] if user else None,
        "last_game_gaze": _serialize_game_record(last_gaze_game),
        "last_game_rhythm": _serialize_game_record(last_rhythm_game),
        "cataract_risk": _serialize_cataract_risk(last_analysis),
        "redness": _serialize_redness(last_analysis),
    }


# 마이페이지의 "누적 기록" 탭 - 4개 항목(백내장/충혈도/미니게임/리듬게임) 중
# 하나를 골라 그 항목의 측정/플레이 기록 전체를 최신순으로 돌려준다.
# "최근 기록 추이"(그래프) 탭은 아직 미구현이라 이 엔드포인트가 필요 없다.
_HISTORY_SERIALIZERS = {
    "cataract": lambda rows: [_serialize_cataract_risk(row) for row in rows],
    "redness": lambda rows: [_serialize_redness(row) for row in rows],
}


@router.get("/api/mypage/history")
async def get_mypage_history(category: str, user_id: int = Depends(get_current_user_id)):
    if category in _HISTORY_SERIALIZERS:
        rows = db.get_analysis_history(user_id)
        records = _HISTORY_SERIALIZERS[category](rows)
    elif category in (db.GAME_TYPE_GAZE, db.GAME_TYPE_RHYTHM):
        rows = db.get_game_history(user_id, category)
        records = [_serialize_game_record(row) for row in rows]
    else:
        raise HTTPException(status_code=400, detail="invalid category")

    return {"records": records}
