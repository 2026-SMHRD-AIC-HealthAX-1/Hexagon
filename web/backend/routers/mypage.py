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


def _serialize_game_record(record):
    if not record:
        return None
    return {"id": record["game_record_id"], "score": record["score"], "played_at": record["played_at"]}


def _serialize_cataract_risk(analysis):
    if not analysis:
        return None
    return {
        "id": analysis["analysis_id"],
        "prob": analysis["cataract_prob"],
        "label": classify_risk(analysis["cataract_prob"]),
        "analyzed_at": analysis["analyzed_at"],
    }


def _serialize_redness(analysis):
    if not analysis:
        return None
    return {"id": analysis["analysis_id"], "ratio": analysis["redness_ratio"], "analyzed_at": analysis["analyzed_at"]}


# 눈 건강 요약 배너(눈 아이콘, js/eyeStatus.js)용 - 가장 최근 측정 1건만 보는
# 대신, 최근 3건에 최신순 가중치(0.5/0.3/0.2)를 줘서 평균 낸 뒤 그 평균값을
# classify_risk()에 통과시킨다. 데이터가 3건보다 적으면 있는 만큼의 가중치만
# 합이 1이 되도록 다시 나눈다(예: 1건이면 그 가중치는 무의미하므로 그대로
# 100%). 현재는 백내장 확률만 반영한다 - 충혈도(redness_ratio)는 HSV 임계값이
# 아직 조명에 따라 과다 측정되는 것으로 확인돼 있어(models/redness_ratio.py,
# AI_Flow.txt 섹션 2) 등급 판정 어디에도 쓰지 않기로 한 기존 결정과 같은
# 이유로 이 가중 평균에도 포함하지 않는다. 그 임계값이 실측 사진으로 튜닝되면
# 이 함수를 다시 열어 충혈도를 함께 반영하도록 사용자에게 다시 물어볼 것.
_RECENT_WEIGHTS = [0.5, 0.3, 0.2]


def _weighted_cataract_status(rows):
    if not rows:
        return None

    weights = _RECENT_WEIGHTS[: len(rows)]
    weight_sum = sum(weights)
    weighted_prob = sum(row["cataract_prob"] * w for row, w in zip(rows, weights)) / weight_sum

    return {
        "prob": weighted_prob,
        "label": classify_risk(weighted_prob),
        "sample_count": len(rows),
    }


@router.get("/api/mypage")
async def get_mypage(user_id: int = Depends(get_current_user_id)):
    user = db.get_user(user_id)
    last_gaze_game = db.get_last_game_record(user_id, db.GAME_TYPE_GAZE)
    last_rhythm_game = db.get_last_game_record(user_id, db.GAME_TYPE_RHYTHM)
    last_analysis = db.get_last_analysis_result(user_id)
    recent_analyses = db.get_recent_analysis_results(user_id, len(_RECENT_WEIGHTS))

    # 백내장 위험도/안구 충혈도: S-03 사진 분석(routers/analysis.py)을 한 번도
    # 하지 않았으면 둘 다 null이고, 프론트가 "측정 미완료"로 표시한다.
    # 등급(정상/주의 필요/위험)은 저장된 값이 아니라 확률에서 그때그때 계산한다 -
    # 경계값의 단일 기준은 models/cataract_cls/infer.py다 (db.py 스키마 주석 참고).
    # cataract_risk/redness는 그 latest 측정 그대로(마이페이지 요약 칸에 쓰는 값)고,
    # eye_status_risk는 눈 건강 요약 배너 전용 가중 평균 값이다 - 서로 다른 목적.
    return {
        "logged_in_at": user["last_login_at"] if user else None,
        "last_game_gaze": _serialize_game_record(last_gaze_game),
        "last_game_rhythm": _serialize_game_record(last_rhythm_game),
        "cataract_risk": _serialize_cataract_risk(last_analysis),
        "redness": _serialize_redness(last_analysis),
        "eye_status_risk": _weighted_cataract_status(recent_analyses),
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


class HistoryDeleteRequest(BaseModel):
    category: str
    ids: list[int]


# 마이페이지 누적 기록 탭의 "삭제 모드" - 체크박스로 고른 레코드의 id만 지운다.
# cataract/redness는 같은 analysis_results 행의 서로 다른 컬럼이라 선택한 id는
# 어느 탭에서 지우든 그 행 전체(백내장 확률 + 충혈도)를 함께 지운다 - 컬럼
# 하나만 지우는 방법은 없다(DB 스키마 주석 참고).
@router.delete("/api/mypage/history")
async def delete_mypage_history(request: HistoryDeleteRequest, user_id: int = Depends(get_current_user_id)):
    if request.category in ("cataract", "redness"):
        db.delete_analysis_results_by_ids(user_id, request.ids)
    elif request.category in (db.GAME_TYPE_GAZE, db.GAME_TYPE_RHYTHM):
        db.delete_game_records_by_ids(user_id, request.category, request.ids)
    else:
        raise HTTPException(status_code=400, detail="invalid category")

    return {"ok": True}
