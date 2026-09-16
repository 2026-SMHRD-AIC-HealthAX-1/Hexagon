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

async function render() {
  const auth = getAuth();
  if (!auth) return; // requireLogin()이 이미 로그인 페이지로 리다이렉트 중

  // 세션 쿠키가 same-origin 요청에 자동으로 실리므로 user_id를 따로 보낼 필요가 없다.
  const data = await fetch("/api/mypage").then((res) => res.json());

  document.getElementById("health-gaze-score").textContent = formatGameScoreSummary(data.last_game_gaze);
  document.getElementById("health-rhythm-score").textContent = formatGameScoreSummary(data.last_game_rhythm);
  document.getElementById("health-cataract-risk").textContent = formatCataractRiskSummary(data.cataract_risk);
  document.getElementById("health-redness").textContent = formatRednessSummary(data.redness);
}

// ---- 누적 기록 / 최근 기록 추이 탭 ----

const HISTORY_CATEGORIES = ["cataract", "redness", "gaze", "rhythm"];
const HISTORY_VIEWS = ["list", "trend"];

let currentCategory = HISTORY_CATEGORIES[0]; // 항상 가장 왼쪽 탭이 기본값
let currentView = HISTORY_VIEWS[0];
const historyCache = new Map(); // category -> records (지연 로드 + 캐시)

// YYYY-MM-DD / HH:MM (요청된 표시 형식) - 브라우저 로컬 시각 기준.
function formatDateTime(isoString) {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} / ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
  const rows = records
    .map(
      (record) => `
        <tr>
          <td>${formatHistoryValue(category, record)}</td>
          <td>${formatDateTime(historyTimestamp(category, record))}</td>
        </tr>
      `,
    )
    .join("");

  container.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>${historyValueLabel(category)}</th>
          <th>측정 일시</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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

const DELETE_CONFIRM_MESSAGE =
  "해당 정보를 삭제할 경우 눈 건강 요약 정보의 정확도에 영향이 있을 수 있습니다. 그래도 삭제할까요?";

async function handleDelete(button, endpoint, affectedCategories) {
  if (!confirm(DELETE_CONFIRM_MESSAGE)) return;

  button.disabled = true;
  try {
    const response = await fetch(endpoint, { method: "DELETE" });
    if (!response.ok) throw new Error();
    affectedCategories.forEach((category) => historyCache.delete(category));
    await render();
    await renderHistoryContent();
  } catch {
    alert("삭제에 실패했습니다. 잠시 후 다시 시도해주세요.");
  } finally {
    button.disabled = false;
  }
}

document.getElementById("delete-analysis-btn").addEventListener("click", (event) => {
  handleDelete(event.currentTarget, "/api/analysis-results", ["cataract", "redness"]);
});

document.getElementById("delete-gaze-records-btn").addEventListener("click", (event) => {
  handleDelete(event.currentTarget, "/api/game-records/gaze", ["gaze"]);
});

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
renderHistoryContent();
