// 눈 건강 요약 배너(눈 아이콘)와 퀵메뉴 FAB의 홍채 색을 계산/적용하는 공용 헬퍼.
// 양호/주의/위험 3단계 기준은 아직 완전히 정해지지 않았으므로(예: blink_alerts
// 빈도 - CLAUDE.md "Home page" 섹션의 보류된 홍채 배너 시안 참고), 우선은
// GET /api/mypage 의 eye_status_risk (최근 3건 백내장 확률에 0.5/0.3/0.2
// 가중치를 준 가중 평균 - routers/mypage.py 의 _weighted_cataract_status()
// 참고, 단순히 최근 1건만 보던 이전 방식에서 "최근" 요약에 더 맞게 바뀐 것)의
// label 을 그대로 매핑한다: 정상->양호, 주의 필요->주의, 위험->위험.
// 충혈도(redness)는 아직 여기 반영하지 않는다 - HSV 임계값이 조명에 따라 과다
// 측정되는 문제가 있어 등급 판정 어디에도 안 쓰기로 한 기존 결정과 같은 이유.
// 그 임계값이 실측 사진으로 튜닝되면 이 계산에 충혈도를 함께 반영할지 다시
// 논의할 것 (_weighted_cataract_status() 주석 참고).
const STATUS_LABELS = {
  good: "양호",
  caution: "주의",
  risk: "위험",
  unknown: "측정 전",
};

export function classifyEyeStatus(eyeStatusRisk) {
  if (!eyeStatusRisk) return "unknown";
  if (eyeStatusRisk.label === "위험") return "risk";
  if (eyeStatusRisk.label === "주의 필요") return "caution";
  if (eyeStatusRisk.label === "정상") return "good";
  return "unknown";
}

// rootEl에 data-eye-status를 설정하면 style.css의 .page[data-eye-status=...]
// 규칙이 --eye-color를 내려주고, 그 값을 눈 아이콘/퀵메뉴 FAB이 공유해서 쓴다.
// iconWrapEl을 넘기면 status가 "unknown"(백내장/충혈도 측정 기록이 아예 없는
// 경우)일 때만 클릭 가능한 형태로 표시한다 - 실제 analysis.html 이동은 클릭
// 시점에 이 함수 밖(home.js/mypage.js)에서 처리한다.
export function applyEyeStatus(rootEl, status, statusTextEl, iconWrapEl) {
  rootEl.dataset.eyeStatus = status;
  if (statusTextEl) {
    statusTextEl.textContent = `종합 상태 · ${STATUS_LABELS[status] || STATUS_LABELS.unknown}`;
  }
  if (iconWrapEl) {
    const clickable = status === "unknown";
    iconWrapEl.classList.toggle("eye-icon-wrap-clickable", clickable);
    if (clickable) {
      iconWrapEl.setAttribute("role", "link");
      iconWrapEl.setAttribute("tabindex", "0");
      iconWrapEl.setAttribute("title", "눌러서 눈 사진으로 측정하기");
    } else {
      iconWrapEl.removeAttribute("role");
      iconWrapEl.removeAttribute("tabindex");
      iconWrapEl.removeAttribute("title");
    }
  }
}
