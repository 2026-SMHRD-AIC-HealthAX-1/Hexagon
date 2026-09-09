const AUTH_KEY = "eyeGodAuth";

export const PROVIDER_LABELS = {
  google: "Google",
  kakao: "카카오",
};

export function getAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;

    const auth = JSON.parse(raw);

    // DB 연동 이전(userId 필드가 생기기 전)에 로그인해서 남은 낡은 상태는
    // /api/mypage?user_id=undefined 같은 깨진 요청으로 이어지므로 로그인 안 된
    // 것으로 취급한다 - requireLogin()이 자연스럽게 재로그인으로 유도한다.
    if (typeof auth.userId !== "number") {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }

    return auth;
  } catch (err) {
    return null;
  }
}

export function isLoggedIn() {
  return getAuth() !== null;
}

export async function logout() {
  // 실제 로그인 상태를 쥐고 있는 건 서버 세션 쿠키이므로, 그것도 함께 지워야
  // 진짜로 로그아웃된다.
  await fetch("/api/auth/logout", { method: "POST" });
  localStorage.removeItem(AUTH_KEY);
}

// 로그인이 필요한 페이지 최상단에서 호출: 비로그인이면 현재 경로를 ?next=로 실어
// login.html로 즉시 리다이렉트한다. index.html은 예외 - 로그인 유도 화면 자체이므로
// 이 함수를 호출하지 않고 로그인 여부에 따라 내용만 다르게 보여준다.
// localStorage를 동기적으로 먼저 확인해 즉시 판단하는 빠른 경로다 - 실제 인가는
// 어차피 서버가 세션 쿠키로 다시 검사하므로, 여기서 오탐(세션 만료인데 localStorage엔
// 남아있는 경우)이 있어도 이후 API 호출이 401을 받으면서 자연히 드러난다.
export function requireLogin() {
  if (isLoggedIn()) {
    return true;
  }

  const next = encodeURIComponent(location.pathname.split("/").pop() || "index.html");
  location.href = `login.html?next=${next}`;

  return false;
}

// 서버 세션(쿠키)과 localStorage의 로그인 상태를 동기화한다. 구글 로그인은
// 서버가 리다이렉트로 완료시키기 때문에 클라이언트 JS가 로그인 성공 시점을
// 직접 알 수 없고, 세션 만료 같은 경우도 localStorage만으로는 알 수 없다 -
// 그래서 페이지 로드마다 이 함수로 서버에 직접 물어봐서 보정한다.
export async function syncAuthWithServer() {
  const data = await fetch("/api/auth/me").then((res) => res.json());

  if (data.logged_in) {
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ provider: data.provider, loggedInAt: data.logged_in_at, userId: data.user_id })
    );
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
}
