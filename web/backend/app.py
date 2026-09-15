import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parents[1]
SRC_DIR = REPO_ROOT / "src"
SCRIPTS_DIR = REPO_ROOT / "scripts"
MODELS_DIR = REPO_ROOT / "models"  # S-03 사진 분석 파이프라인(eye_analysis.py)

for path in (SRC_DIR, BACKEND_DIR, SCRIPTS_DIR, MODELS_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

import db
import setup_mediapipe
from routers.calibration_ws import router as calibration_router
from routers.game_ws import router as game_router
from routers.blink_ws import router as blink_router
from routers.rhythm_game_ws import router as rhythm_game_router
from routers.config import router as config_router
from routers.clinics import router as clinics_router
from routers.auth import router as auth_router
from routers.mypage import router as mypage_router
from routers.calibration_api import router as calibration_api_router
from routers.analysis import router as analysis_router

db.init_db()

# 두 미니게임의 기본(클라이언트 계산) 페이지와 캘리브레이션 메뉴가 쓰는
# 브라우저용 MediaPipe 자산(web/frontend/vendor/mediapipe/)은 용량이 커서
# 저장소에 커밋하지 않고 scripts/setup_mediapipe.py 로 로컬에 받아둔다.
# 예전에는 이걸 깜빡하면 게임 진입 시에야 "얼굴 인식 모델을 불러오지
# 못했습니다" alert 로 알게 됐는데, 서버 기동 시점에 한 번 확인해서 없으면
# 바로 받아버리면 그 수동 단계가 아예 필요 없어진다 - 이미 받아져 있으면
# already_installed() 가 즉시 True 를 반환하므로 --reload 로 재기동될 때마다
# 매번 다시 받지는 않는다. 네트워크 문제 등으로 실패해도 이 기능만 없을 뿐
# 서버 자체는 계속 뜨게(다른 기능은 정상 동작) 예외를 삼킨다.
if not setup_mediapipe.already_installed():
    print("[app] 브라우저용 MediaPipe 자산이 없어 최초 1회 내려받습니다...")
    try:
        setup_mediapipe.download_and_extract()
        setup_mediapipe.copy_model()
        print("[app] MediaPipe 자산 준비 완료.")
    except Exception as exc:
        print(f"[app] MediaPipe 자산 자동 설치 실패: {exc}")
        print("      수동으로 실행해주세요: python scripts/setup_mediapipe.py")

app = FastAPI(title="Eye God Web (bootstrap)")

# 로그인 세션 쿠키 (실제 Google OAuth 로그인의 신원 확인 수단, see routers/auth.py).
# https_only=False는 지금의 로컬 http://localhost 개발 단계에서만 맞는 값이다 -
# 실제 도메인으로 배포하면 반드시 True로 바꿔야 한다 (CLAUDE.md "Database"/"Login" 참고).
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET_KEY"],
    max_age=60 * 60 * 24 * 30,
    same_site="lax",
    https_only=False,
)

app.include_router(calibration_router)
app.include_router(game_router)
app.include_router(blink_router)
app.include_router(rhythm_game_router)
app.include_router(config_router)
app.include_router(clinics_router)
app.include_router(auth_router)
app.include_router(mypage_router)
app.include_router(calibration_api_router)
app.include_router(analysis_router)

FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
