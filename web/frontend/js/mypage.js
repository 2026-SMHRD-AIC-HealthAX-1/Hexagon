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

  renderMeasurement(
    "cataract-risk",
    data.cataract_risk,
    (risk) => `${(risk.prob * 100).toFixed(1)}% · ${risk.label}`,
  );
  renderMeasurement(
    "redness",
    data.redness,
    (redness) => `${(redness.ratio * 100).toFixed(1)}%`,
  );

  renderGameScore("gaze-game-score", data.last_game_gaze);
  renderGameScore("rhythm-game-score", data.last_game_rhythm);
}

// 사진 분석(S-03)을 한 번도 하지 않았으면 HTML의 "측정 기록 없음" 기본값을 그대로 둔다.
function renderMeasurement(elementId, measurement, format) {
  if (!measurement) return;

  const el = document.getElementById(elementId);
  el.textContent = `${format(measurement)} (${formatDate(measurement.analyzed_at)})`;
  el.classList.remove("muted");
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
