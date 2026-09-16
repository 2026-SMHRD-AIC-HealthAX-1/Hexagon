import { getAuth, requireLogin, syncAuthWithServer, logout } from "./auth.js";

await syncAuthWithServer();
requireLogin();

const NOT_MEASURED = "측정 미완료";

// 홈 화면(home.js)의 눈 건강 요약 패널과 동일한 포맷 - 날짜 없이 요약만 보여준다.
function formatGameScoreSummary(lastGame) {
  return lastGame ? `${lastGame.score}점` : NOT_MEASURED;
}

function formatCataractRiskSummary(risk) {
  return risk ? `${(risk.prob * 100).toFixed(0)}% · ${risk.label}` : NOT_MEASURED;
}

function formatRednessSummary(redness) {
  return redness ? `${(redness.ratio * 100).toFixed(0)}%` : NOT_MEASURED;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleString("ko-KR");
}

async function render() {
  const auth = getAuth();
  if (!auth) return; // requireLogin()이 이미 로그인 페이지로 리다이렉트 중

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  const data = await fetch("/api/mypage").then((res) => res.json());

  document.getElementById("health-gaze-score").textContent = formatGameScoreSummary(data.last_game_gaze);
  document.getElementById("health-rhythm-score").textContent = formatGameScoreSummary(data.last_game_rhythm);
  document.getElementById("health-cataract-risk").textContent = formatCataractRiskSummary(data.cataract_risk);
  document.getElementById("health-redness").textContent = formatRednessSummary(data.redness);

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

// home.js의 퀵메뉴 FAB과 동일한 토글 로직 (마크업/CSS도 index.html과 동일하게 재사용).
const quickFab = document.getElementById("quick-fab");
const quickMenu = document.getElementById("quick-menu");

quickFab.addEventListener("click", () => {
  quickMenu.classList.toggle("show");
});

render();
