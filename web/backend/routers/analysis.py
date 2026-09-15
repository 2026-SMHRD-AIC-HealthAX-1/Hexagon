"""S-03 사진 분석 - 업로드된 눈 사진을 백내장 위험도 + 충혈도로 분석한다.

**원본 사진은 서버에 절대 저장하지 않는다** (개인정보). 그래서 구현이 좀
특이한 부분이 두 군데 있다:

1. multipart(UploadFile)가 아니라 요청 본문(raw body)을 그대로 받는다.
   Starlette의 UploadFile은 약 1MB가 넘으면 내용을 디스크의 임시 파일로
   흘려보내는데(SpooledTemporaryFile), 스마트폰 사진은 그 크기를 쉽게 넘는다.
   임시 파일은 곧 지워지긴 하지만 어쨌든 원본이 디스크에 한 번 쓰이므로,
   본문을 통째로 메모리에서 받는 쪽을 택했다. 덤으로 python-multipart
   의존성도 필요 없어진다.
2. 분석도 파일 경로가 아니라 메모리의 이미지 배열로 넘긴다
   (models/eye_analysis.py의 analyze_image()).

DB(analysis_results)에 남는 것도 분석 결과 수치뿐이고 사진은 남지 않는다.
"""
import asyncio

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request

import db
from eye_analysis import analyze_image
from routers.auth import get_current_user_id

router = APIRouter()

# 스마트폰 원본 사진도 보통 10MB 안에 들어온다. 본문을 통째로 메모리에 올리는
# 구조라 상한이 없으면 큰 요청 하나로 메모리를 밀어버릴 수 있어서 막아둔다.
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


@router.post("/api/analysis")
async def post_analysis(request: Request, user_id: int = Depends(get_current_user_id)):
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="이미지가 비어 있습니다.")
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="이미지가 너무 큽니다. (최대 15MB)")

    img_bgr = cv2.imdecode(np.frombuffer(body, np.uint8), cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise HTTPException(status_code=400, detail="이미지를 읽을 수 없습니다.")

    # MediaPipe를 워커 스레드로 돌리는 WS 라우터들과 같은 이유 - YOLO 추론은
    # 몇백 ms 동안 CPU를 잡고 있어서, 이벤트 루프에서 직접 돌리면 그동안 다른
    # 요청이 전부 멈춘다.
    result = await asyncio.get_running_loop().run_in_executor(None, analyze_image, img_bgr)

    if not result["ok"]:
        return {
            "ok": False,
            "missing": result["missing"],
            "message": f"사진에서 {', '.join(result['missing'])} 영역을 찾지 못했습니다. 다시 촬영해주세요.",
        }

    db.insert_analysis_result(user_id, result["cataract_prob"], result["redness_ratio"])

    return {
        "ok": True,
        "cataract_prob": result["cataract_prob"],
        "cataract_label": result["cataract_label"],
        "redness_ratio": result["redness_ratio"],
    }
