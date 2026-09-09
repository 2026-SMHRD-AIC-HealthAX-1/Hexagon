function redirectTarget() {
  const params = new URLSearchParams(location.search);
  return params.get("next") || "index.html";
}

document.getElementById("google-login-btn").addEventListener("click", () => {
  // 실제 Google OAuth - 서버가 구글로 리다이렉트하고, 콜백 완료 후 next로 되돌려보낸다.
  // (see web/backend/routers/auth.py의 google_login/google_callback)
  window.location.href = `/api/auth/google/login?next=${encodeURIComponent(redirectTarget())}`;
});

document.getElementById("kakao-login-btn").addEventListener("click", () => {
  // 실제 Kakao OAuth - google-login-btn과 동일한 패턴.
  // (see web/backend/routers/auth.py의 kakao_login/kakao_callback)
  window.location.href = `/api/auth/kakao/login?next=${encodeURIComponent(redirectTarget())}`;
});
