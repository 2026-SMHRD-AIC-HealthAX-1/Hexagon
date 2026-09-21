import os
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

import db

router = APIRouter()

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"

KAKAO_AUTH_ENDPOINT = "https://kauth.kakao.com/oauth/authorize"
KAKAO_TOKEN_ENDPOINT = "https://kauth.kakao.com/oauth/token"
KAKAO_USERINFO_ENDPOINT = "https://kapi.kakao.com/v2/user/me"


def get_current_user_id(request: Request) -> int:
    # 세션 쿠키(SessionMiddleware, see app.py)에서 로그인한 사용자를 식별한다.
    # 프론트가 보낸 값을 신뢰하던 이전 mock 방식과 달리, 이건 서버가 서명한 쿠키라
    # 클라이언트가 임의로 위조할 수 없다.
    user_id = request.session.get("user_id")
    if user_id is None:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    return user_id


@router.post("/api/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/api/auth/me")
async def me(request: Request):
    user_id = request.session.get("user_id")
    if user_id is None:
        return {"logged_in": False}

    user = db.get_user(user_id)
    if user is None:
        return {"logged_in": False}

    return {
        "logged_in": True,
        "user_id": user_id,
        "provider": user["provider"],
        "logged_in_at": user["last_login_at"],
        "nickname": user["nickname"],
        "data_consent": user["data_consent_at"] is not None,
    }


class NicknameRequest(BaseModel):
    nickname: str
    # 최초 로그인 시 닉네임 설정 모달(js/nickname.js)이 데이터 수집 동의 체크박스도
    # 같이 받는다 - 반드시 명시적으로 true여야 하고(체크 안 하면 아예 요청조차
    # 못 보내게 프론트에서 막지만, 서버도 동일하게 강제한다), 기본값을 두지 않는 건
    # 값을 빠뜨린 요청을 "동의 안 함"과 구분 없이 거부하기 위해서다.
    consent: bool


NICKNAME_MAX_LENGTH = 20


# 최초 로그인 시 클라이언트(js/nickname.js)가 닉네임+동의 설정 모달을 띄운 뒤
# 호출하는 엔드포인트 - 닉네임 중복 여부는 따로 검사하지 않는다(요청 범위 밖).
# 데이터 수집(게임 기록/눈 깜빡임 경고/사진 분석 결과) 동의에 체크하지 않으면
# 닉네임 자체를 저장하지 않는다 - 동의 없이는 서비스를 이용할 수 없다는 요구사항이라,
# 닉네임 설정과 동의를 한 번에 같이 받아야 그 이후 어떤 화면도 통과시키지 않을 수 있다.
@router.post("/api/auth/nickname")
async def set_nickname(request: NicknameRequest, user_id: int = Depends(get_current_user_id)):
    nickname = request.nickname.strip()
    if not nickname or len(nickname) > NICKNAME_MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"닉네임은 1~{NICKNAME_MAX_LENGTH}자로 입력해주세요.")
    if not request.consent:
        raise HTTPException(status_code=400, detail="데이터 수집 및 저장에 동의해야 서비스를 이용할 수 있습니다.")

    db.set_nickname(user_id, nickname)
    db.set_data_consent(user_id)
    return {"ok": True, "nickname": nickname, "data_consent": True}


# 닉네임은 이미 있지만(=예전에 가입한 사용자) 아직 동의 기록이 없는 경우를 위한
# 별도 엔드포인트 - 닉네임 재입력 없이 동의만 받는다. js/nickname.js의
# ensureNickname()이 두 경우를 구분해서 이 엔드포인트 또는 위 /api/auth/nickname을 부른다.
@router.post("/api/auth/consent")
async def set_consent(user_id: int = Depends(get_current_user_id)):
    db.set_data_consent(user_id)
    return {"ok": True, "data_consent": True}


@router.get("/api/auth/google/login")
async def google_login(request: Request, next: str = "index.html"):
    # state는 CSRF 방지용 - 콜백에서 세션에 저장된 값과 정확히 일치하는지 확인한다.
    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state
    request.session["oauth_next"] = next

    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": str(request.url_for("google_callback")),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
    }
    return RedirectResponse(f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}")


@router.get("/api/auth/google/callback")
async def google_callback(request: Request, code: str, state: str):
    expected_state = request.session.pop("oauth_state", None)
    if not expected_state or state != expected_state:
        raise HTTPException(status_code=400, detail="잘못된 요청입니다 (state mismatch).")

    redirect_uri = str(request.url_for("google_callback"))

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_response = await client.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": os.environ["GOOGLE_CLIENT_ID"],
                "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_response.raise_for_status()
        access_token = token_response.json()["access_token"]

        userinfo_response = await client.get(
            GOOGLE_USERINFO_ENDPOINT,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        userinfo_response.raise_for_status()
        userinfo = userinfo_response.json()

    google_sub = userinfo["sub"]
    email = userinfo.get("email")

    user = db.get_user_by_google_sub(google_sub)
    if user is None:
        user_id = db.create_user("google", google_sub=google_sub, email=email)
    else:
        user_id = user["id"]
        db.touch_user_login(user_id, "google", email=email)

    request.session["user_id"] = user_id
    next_path = request.session.pop("oauth_next", "index.html")

    return RedirectResponse(f"/{next_path}")


@router.get("/api/auth/kakao/login")
async def kakao_login(request: Request, next: str = "index.html"):
    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state
    request.session["oauth_next"] = next

    params = {
        "client_id": os.environ["KAKAO_CLIENT_ID"],
        "redirect_uri": str(request.url_for("kakao_callback")),
        "response_type": "code",
        "state": state,
    }
    return RedirectResponse(f"{KAKAO_AUTH_ENDPOINT}?{urlencode(params)}")


@router.get("/api/auth/kakao/callback")
async def kakao_callback(request: Request, code: str, state: str):
    expected_state = request.session.pop("oauth_state", None)
    if not expected_state or state != expected_state:
        raise HTTPException(status_code=400, detail="잘못된 요청입니다 (state mismatch).")

    redirect_uri = str(request.url_for("kakao_callback"))

    token_data = {
        "grant_type": "authorization_code",
        "client_id": os.environ["KAKAO_CLIENT_ID"],
        "redirect_uri": redirect_uri,
        "code": code,
    }
    # Client Secret은 카카오 콘솔에서 활성화했을 때만 필요하다 - 비활성 상태에서
    # 보내면 오히려 invalid_client 오류가 나므로 설정된 경우에만 포함시킨다.
    kakao_client_secret = os.environ.get("KAKAO_CLIENT_SECRET")
    if kakao_client_secret:
        token_data["client_secret"] = kakao_client_secret

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_response = await client.post(KAKAO_TOKEN_ENDPOINT, data=token_data)
        token_response.raise_for_status()
        access_token = token_response.json()["access_token"]

        userinfo_response = await client.get(
            KAKAO_USERINFO_ENDPOINT,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        userinfo_response.raise_for_status()
        userinfo = userinfo_response.json()

    # id는 항상 존재하지만, 이메일은 앱에서 이메일 동의항목을 활성화하고(+ 필요시
    # 비즈 앱 전환) 사용자가 동의한 경우에만 kakao_account 안에 존재한다.
    kakao_id = str(userinfo["id"])
    email = userinfo.get("kakao_account", {}).get("email")

    user = db.get_user_by_kakao_id(kakao_id)
    if user is None:
        user_id = db.create_user("kakao", kakao_id=kakao_id, email=email)
    else:
        user_id = user["id"]
        db.touch_user_login(user_id, "kakao", email=email)

    request.session["user_id"] = user_id
    next_path = request.session.pop("oauth_next", "index.html")

    return RedirectResponse(f"/{next_path}")
