import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parents[1]
SRC_DIR = REPO_ROOT / "src"

for path in (SRC_DIR, BACKEND_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from dotenv import load_dotenv

load_dotenv(REPO_ROOT / ".env")

import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

import db
from routers.calibration_ws import router as calibration_router
from routers.game_ws import router as game_router
from routers.blink_ws import router as blink_router
from routers.rhythm_game_ws import router as rhythm_game_router
from routers.config import router as config_router
from routers.clinics import router as clinics_router
from routers.auth import router as auth_router
from routers.mypage import router as mypage_router
from routers.calibration_api import router as calibration_api_router

db.init_db()

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

FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
