import os

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/config")
async def get_config():
    return {
        "naverMapClientId": os.environ.get("NAVER_MAP_CLIENT_ID", ""),
    }
