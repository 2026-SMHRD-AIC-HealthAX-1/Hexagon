import { getAuth, requireLogin, syncAuthWithServer, logout } from "./auth.js";
import { classifyEyeStatus, applyEyeStatus } from "./eyeStatus.js";
import { initQuickPhotoMenu } from "./quickPhotoMenu.js";
import { formatDateTime, fetchGameRanking, renderRankingTable } from "./ranking.js";

await syncAuthWithServer();
requireLogin();

const NOT_MEASURED = "측정 미완료";

const pageRoot = document.querySelector(".page");
const eyeIconWrap = document.getElementById("eye-icon-wrap");

// 백내장/충혈도 측정 기록이 아예 없어 종합 상태가 "측정 전"(unknown)일 때만
// 눈 아이콘을 클릭 가능하게 만들어 바로 사진 분석으로 유도한다 - home.js와
// 동일한 동작(applyEyeStatus()가 클래스/속성을 갱신, 클릭 시 상태만 확인).
eyeIconWrap.addEventListener("click", () => {
  if (pageRoot.dataset.eyeStatus === "unknown") {
    location.href = "analysis.html";
  }
});

eyeIconWrap.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && pageRoot.dataset.eyeStatus === "unknown") {
    event.preventDefault();
    location.href = "analysis.html";
  }
});

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

async function render() {
  const auth = getAuth();
  if (!auth) return; // requireLogin()이 이미 로그인 페이지로 리다이렉트 중

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  const data = await fetch("/api/mypage").then((res) => res.json());

  document.getElementById("health-gaze-score").textContent = formatGameScoreSummary(data.last_game_gaze);
  document.getElementById("health-rhythm-score").textContent = formatGameScoreSummary(data.last_game_rhythm);
  document.getElementById("health-cataract-risk").textContent = formatCataractRiskSummary(data.cataract_risk);
  document.getElementById("health-redness").textContent = formatRednessSummary(data.redness);
  applyEyeStatus(pageRoot, classifyEyeStatus(data.eye_status_risk), document.getElementById("eye-status-text"), eyeIconWrap);
}

// ---- 누적 기록 / 최근 기록 추이 탭 ----

const HISTORY_CATEGORIES = ["cataract", "redness", "gaze", "rhythm"];
const HISTORY_VIEWS = ["list", "trend"];

let currentCategory = HISTORY_CATEGORIES[0]; // 항상 가장 왼쪽 탭이 기본값
let currentView = HISTORY_VIEWS[0];
let deleteMode = false; // "기록 삭제" 버튼으로 켜짐 - 상위 탭을 옮겨도 유지된다.
const historyCache = new Map(); // category -> records (지연 로드 + 캐시)

function formatHistoryValue(category, record) {
  if (category === "cataract") return `${(record.prob * 100).toFixed(1)}% · ${record.label}`;
  if (category === "redness") return `${(record.ratio * 100).toFixed(1)}%`;
  return `${record.score}점`; // gaze, rhythm
}

// 테이블 첫 번째 열 제목 - 항목마다 무엇을 측정/기록한 값인지 명시.
function historyValueLabel(category) {
  if (category === "cataract") return "백내장 위험도";
  if (category === "redness") return "안구 충혈도";
  return "게임 점수"; // gaze, rhythm
}

function historyTimestamp(category, record) {
  return category === "gaze" || category === "rhythm" ? record.played_at : record.analyzed_at;
}

async function fetchHistory(category) {
  if (!historyCache.has(category)) {
    const data = await fetch(`/api/mypage/history?category=${category}`).then((res) => res.json());
    historyCache.set(category, data.records);
  }
  return historyCache.get(category);
}

function renderHistoryList(container, category, records) {
  if (!records.length) {
    container.innerHTML = `<div class="history-empty">측정 기록이 없습니다.</div>`;
    return;
  }

  // 백엔드가 이미 최신순(analyzed_at/played_at DESC)으로 정렬해 내려준다.
  // 삭제 모드일 때만 각 행에 체크박스 열을 붙인다 - 최근 기록 추이 탭에는
  // 이 함수 자체가 호출되지 않으므로 선택 삭제는 누적 기록 탭에만 적용된다.
  const rows = records
    .map(
      (record) => `
        <tr>
          <td>${formatHistoryValue(category, record)}</td>
          <td class="history-date-col">${formatDateTime(historyTimestamp(category, record))}</td>
          ${deleteMode ? `<td class="history-checkbox-col"><input type="checkbox" class="history-row-checkbox" data-id="${record.id}"></td>` : ""}
        </tr>
      `,
    )
    .join("");

  const checkboxHeader = deleteMode
    ? `<th class="history-checkbox-col"><label class="history-select-all"><span class="history-select-all-text">전체<br>선택</span><input type="checkbox" id="history-select-all-checkbox"></label></th>`
    : "";

  container.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>${historyValueLabel(category)}</th>
          <th>측정 일시</th>
          ${checkboxHeader}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  if (deleteMode) {
    const selectAll = document.getElementById("history-select-all-checkbox");
    const rowCheckboxes = container.querySelectorAll(".history-row-checkbox");
    selectAll.addEventListener("change", () => {
      rowCheckboxes.forEach((checkbox) => {
        checkbox.checked = selectAll.checked;
      });
    });
  }
}

// ---- 최근 기록 추이 (꺾은선 그래프) ----

const TREND_MIN_RECORDS = 5; // 이보다 적으면 추이를 그리기엔 데이터가 부족하다고 판단.
const TREND_MAX_POINTS = 10; // 그래프에는 최근 기록 최대 10개까지만 표시.
const TREND_PERCENT_CATEGORIES = ["cataract", "redness"]; // 세로축을 0~100%로 고정할 항목.

function trendValue(category, record) {
  if (category === "cataract") return record.prob * 100;
  if (category === "redness") return record.ratio * 100;
  return record.score; // gaze, rhythm
}

// 그래프 세로축 설명 - 캡션과 y축 눈금 단위 표기에 쓰인다.
function trendValueLabel(category) {
  if (category === "cataract") return "백내장 위험도(%)";
  if (category === "redness") return "안구 충혈도(%)";
  return "게임 점수"; // gaze, rhythm
}

function formatTrendAxisValue(category, value) {
  if (category === "cataract" || category === "redness") return `${value.toFixed(0)}%`;
  return `${Math.round(value)}`;
}

// x축 라벨용 짧은 날짜(MM-DD) - 툴팁은 formatDateTime()의 전체 표기를 그대로 쓴다.
function formatTrendAxisDate(isoString) {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function renderTrendChart(container, category, records) {
  // 기록은 최신순(DESC)으로 오므로, 최근 TREND_MAX_POINTS개만 자른 다음
  // 그래프는 시간순(오래된 -> 최근)으로 보여주기 위해 뒤집는다.
  const capped = records.slice(0, TREND_MAX_POINTS);
  const chronological = [...capped].reverse();
  const values = chronological.map((record) => trendValue(category, record));

  const width = 640;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 36, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  let yMin;
  let yMax;
  if (TREND_PERCENT_CATEGORIES.includes(category)) {
    // 백내장 위험도 / 안구 충혈도는 항상 0~100% 범위로 고정 - 값이 튀어도
    // 축 범위가 매번 바뀌지 않아야 추이를 비교하기 쉽다.
    yMin = 0;
    yMax = 100;
  } else {
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue || 1;
    // 값이 그래프 위아래 가장자리에 딱 붙지 않도록 여유를 둔다.
    yMin = minValue - valueRange * 0.15;
    yMax = maxValue + valueRange * 0.15;
  }

  const n = chronological.length;
  const xAt = (i) => padding.left + (n > 1 ? (i * plotWidth) / (n - 1) : plotWidth / 2);
  const yAt = (value) => padding.top + plotHeight * (1 - (value - yMin) / (yMax - yMin));

  const points = chronological.map((record, i) => ({
    x: xAt(i),
    y: yAt(values[i]),
    record,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const GRID_STEPS = 4;
  const gridYs = Array.from({ length: GRID_STEPS + 1 }, (_, i) => padding.top + (plotHeight * i) / GRID_STEPS);

  const gridLines = gridYs
    .map((y) => `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="trend-grid" />`)
    .join("");

  const yAxisLabels = gridYs
    .map((y, i) => {
      const value = yMax - ((yMax - yMin) * i) / GRID_STEPS;
      return `<text x="${padding.left - 8}" y="${y + 4}" class="trend-axis-label" text-anchor="end">${formatTrendAxisValue(category, value)}</text>`;
    })
    .join("");

  // 점이 많으면 x축 라벨을 다 찍으면 겹치므로 적당히 솎아내되, 마지막 점 라벨은 항상 남긴다.
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const xAxisLabels = points
    .map((p, i) => {
      if (i % labelStep !== 0 && i !== n - 1) return "";
      return `<text x="${p.x}" y="${height - padding.bottom + 18}" class="trend-axis-label" text-anchor="middle">${formatTrendAxisDate(historyTimestamp(category, p.record))}</text>`;
    })
    .join("");

  const circles = points
    .map(
      (p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" class="trend-point" data-index="${i}" />`,
    )
    .join("");

  const cappedNote = records.length > TREND_MAX_POINTS ? ` (최근 ${TREND_MAX_POINTS}건 기준)` : "";

  container.innerHTML = `
    <div class="trend-chart-wrap">
      <div class="trend-caption">${trendValueLabel(category)} 추이 · 가로축: 측정 일시${cappedNote}</div>
      <div class="trend-chart-container">
        <svg viewBox="0 0 ${width} ${height}" class="trend-chart" role="img" aria-label="${trendValueLabel(category)} 추이 그래프">
          ${gridLines}
          ${yAxisLabels}
          <path d="${linePath}" class="trend-line" />
          ${circles}
          ${xAxisLabels}
        </svg>
        <div class="trend-tooltip" hidden></div>
      </div>
    </div>
  `;

  attachTrendTooltips(container, category, points);
}

// 각 점에 커스텀 툴팁을 붙인다 - SVG 네이티브 <title>은 브라우저 기본 딜레이/스타일에
// 의존해서 신뢰하기 어려워, 마우스 이벤트로 직접 위치를 계산해 보여준다.
function attachTrendTooltips(container, category, points) {
  const chartContainer = container.querySelector(".trend-chart-container");
  const tooltip = container.querySelector(".trend-tooltip");

  function showTooltip(circle, point) {
    tooltip.textContent = `${formatDateTime(historyTimestamp(category, point.record))} · ${formatHistoryValue(category, point.record)}`;
    tooltip.hidden = false;

    const circleRect = circle.getBoundingClientRect();
    const containerRect = chartContainer.getBoundingClientRect();
    tooltip.style.left = `${circleRect.left + circleRect.width / 2 - containerRect.left}px`;
    tooltip.style.top = `${circleRect.top - containerRect.top}px`;
  }

  container.querySelectorAll(".trend-point").forEach((circle) => {
    const point = points[Number(circle.dataset.index)];
    circle.addEventListener("mouseenter", () => showTooltip(circle, point));
    circle.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
    });
  });
}

function renderTrendView(container, category, records) {
  if (records.length < TREND_MIN_RECORDS) {
    container.innerHTML = `<div class="history-empty">아직 추이를 분석하기에 데이터가 부족합니다.</div>`;
    return;
  }

  renderTrendChart(container, category, records);
}

async function renderHistoryContent() {
  const container = document.getElementById("history-content");
  const category = currentCategory;
  const view = currentView;

  container.innerHTML = `<div class="history-empty">불러오는 중...</div>`;
  const records = await fetchHistory(category);

  // 응답을 기다리는 동안 사용자가 다른 탭으로 옮겼으면 이 결과는 버린다.
  if (category !== currentCategory || view !== currentView) return;

  if (view === "trend") {
    renderTrendView(container, category, records);
  } else {
    renderHistoryList(container, category, records);
  }
}

function setActiveTab(buttons, activeButton) {
  buttons.forEach((button) => button.classList.toggle("active", button === activeButton));
}

const primaryTabButtons = document.querySelectorAll(".tabs-primary .tab-btn");
const secondaryTabButtons = document.querySelectorAll(".tabs-secondary .tab-btn");

primaryTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.category === currentCategory) return;
    currentCategory = button.dataset.category;
    setActiveTab(primaryTabButtons, button);
    renderHistoryContent();
  });
});

secondaryTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view === currentView) return;
    currentView = button.dataset.view;
    setActiveTab(secondaryTabButtons, button);
    renderHistoryContent();
  });
});

// ---- 게임 랭킹 TOP 10 ----
//
// 개인 기록(history)과 달리 로그인한 본인 것이 아니라 해당 게임 종류 전체
// 사용자 중 점수 상위 10명을 보여준다. 실제 기록이 10개가 안 되면 나머지는
// 빈 행("-")으로 채워 항상 10행을 유지한다.

const RANKING_GAMES = ["gaze", "rhythm"];

let currentRankingGame = RANKING_GAMES[0]; // 항상 가장 왼쪽 탭이 기본값
const rankingCache = new Map(); // game_type -> records (지연 로드 + 캐시)

async function fetchRanking(gameType) {
  if (!rankingCache.has(gameType)) {
    rankingCache.set(gameType, await fetchGameRanking(gameType));
  }
  return rankingCache.get(gameType);
}

async function renderRankingContent() {
  const container = document.getElementById("ranking-content");
  const gameType = currentRankingGame;

  container.innerHTML = `<div class="history-empty">불러오는 중...</div>`;
  const records = await fetchRanking(gameType);

  // 응답을 기다리는 동안 사용자가 다른 탭으로 옮겼으면 이 결과는 버린다.
  if (gameType !== currentRankingGame) return;

  renderRankingTable(container, records);
}

const rankingTabButtons = document.querySelectorAll(".tabs-ranking .tab-btn");

rankingTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.game === currentRankingGame) return;
    currentRankingGame = button.dataset.game;
    setActiveTab(rankingTabButtons, button);
    renderRankingContent();
  });
});

// ---- 기록 삭제 (선택 삭제) ----
//
// "기록 삭제" 한 번 누르면 안내 문구 동의 후 삭제 모드로 들어간다 - 이때부터
// 버튼이 "삭제"(붉은 버튼)로 바뀌고, 누적 기록 탭의 테이블에 체크박스 열이
// 붙는다. 삭제 모드는 상위 탭(카테고리/뷰)을 옮겨도 풀리지 않는 전역 상태다
// (deleteMode 변수 하나로 관리 - renderHistoryList()가 매번 그 값을 참고해
// 체크박스를 넣을지 정한다).
const DELETE_MODE_CONFIRM_MESSAGE =
  "기록의 일부 또는 전체를 삭제할 경우\n눈 건강 요약 정보 제공에 영향이 있습니다.\n그럼에도 삭제 모드로 진입하시겠습니까?";

const deleteBtn = document.getElementById("delete-records-btn");

function updateDeleteButtonUI() {
  deleteBtn.textContent = deleteMode ? "삭제" : "기록 삭제";
  deleteBtn.classList.toggle("delete-mode-active", deleteMode);
}

async function executeSelectedDelete() {
  const ids = Array.from(document.querySelectorAll(".history-row-checkbox:checked")).map((checkbox) =>
    Number(checkbox.dataset.id),
  );

  if (!ids.length) {
    alert("선택된 기록이 없습니다.");
    return;
  }

  deleteBtn.disabled = true;
  try {
    const response = await fetch("/api/mypage/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: currentCategory, ids }),
    });
    if (!response.ok) throw new Error();
    // 요구사항대로 삭제 후 바로 새로고침 - 요약 패널/기록 캐시를 따로 갱신할 필요가 없다.
    location.reload();
  } catch {
    alert("삭제에 실패했습니다. 잠시 후 다시 시도해주세요.");
    deleteBtn.disabled = false;
  }
}

deleteBtn.addEventListener("click", () => {
  if (!deleteMode) {
    if (!confirm(DELETE_MODE_CONFIRM_MESSAGE)) return;
    deleteMode = true;
    updateDeleteButtonUI();
    renderHistoryContent();
    return;
  }

  executeSelectedDelete();
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  if (!confirm("로그아웃 하시겠습니까?")) return;
  await logout();
  requireLogin();
});

// 퀵메뉴 동작은 index.html과 완전히 동일 - quickPhotoMenu.js 한 곳에만 둔다.
initQuickPhotoMenu();

render();
renderHistoryContent();
renderRankingContent();
