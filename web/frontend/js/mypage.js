import { getAuth, requireLogin, syncAuthWithServer, logout, PROVIDER_LABELS } from "./auth.js";

await syncAuthWithServer();
requireLogin();

function formatDate(isoString) {
  return new Date(isoString).toLocaleString("ko-KR");
}

async function render() {
  const auth = getAuth();
  if (!auth) return; // requireLogin()이 이미 로그인 페이지로 리다이렉트 중

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  const data = await fetch("/api/mypage").then((res) => res.json());

  document.getElementById("last-visit").textContent =
    `${formatDate(data.logged_in_at)} (${PROVIDER_LABELS[auth.provider] || auth.provider} 로그인)`;

  // 백내장 위험도 / 안구 충혈도: 사진 분석(S-03) 기능이 아직 구현되지 않아
  // 서버가 항상 null을 반환한다 - "측정 기록 없음" 플레이스홀더 유지 (HTML 기본값 그대로).

  renderGameScore("gaze-game-score", data.last_game_gaze);
  renderGameScore("rhythm-game-score", data.last_game_rhythm);
}

function renderGameScore(elementId, lastGame) {
  const el = document.getElementById(elementId);

  if (lastGame) {
    el.textContent = `${lastGame.score}점 (${formatDate(lastGame.played_at)})`;
  } else {
    el.textContent = "플레이 기록 없음";
    el.classList.add("muted");
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await logout();
  requireLogin();
});

render();
