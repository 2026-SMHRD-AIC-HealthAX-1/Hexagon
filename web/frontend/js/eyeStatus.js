// 눈 건강 요약 배너(눈 아이콘)와 퀵메뉴 FAB의 홍채 색을 계산/적용하는 공용 헬퍼.
// 양호/주의/위험 3단계 기준은 아직 정해지지 않았으므로(예: blink_alerts 빈도 -
// CLAUDE.md "Home page" 섹션의 보류된 홍채 배너 시안 참고), 우선은 가장 최근
// 백내장 분석 결과만 그대로 매핑한다: 정상->양호, 주의 필요->주의, 위험->위험.
const STATUS_LABELS = {
  good: "양호",
  caution: "주의",
  risk: "위험",
  unknown: "측정 전",
};

export function classifyEyeStatus(cataractRisk) {
  if (!cataractRisk) return "unknown";
  if (cataractRisk.label === "위험") return "risk";
  if (cataractRisk.label === "주의 필요") return "caution";
  if (cataractRisk.label === "정상") return "good";
  return "unknown";
}

// rootEl에 data-eye-status를 설정하면 style.css의 .page[data-eye-status=...]
// 규칙이 --eye-color를 내려주고, 그 값을 눈 아이콘/퀵메뉴 FAB이 공유해서 쓴다.
export function applyEyeStatus(rootEl, status, statusTextEl) {
  rootEl.dataset.eyeStatus = status;
  if (statusTextEl) {
    statusTextEl.textContent = `종합 상태 · ${STATUS_LABELS[status] || STATUS_LABELS.unknown}`;
  }
}
