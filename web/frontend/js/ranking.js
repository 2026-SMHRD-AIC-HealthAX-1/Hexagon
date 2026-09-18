// 게임 랭킹 TOP 10 표시 - 마이페이지의 "게임 랭킹" 탭과 각 게임 결과창이
// 같은 표 형식(회원 번호/게임 점수/게임 플레이 일시, 빈 행은 "-")을 쓰도록
// 공유하는 모듈. GET /api/mypage/ranking?game_type= 하나만 감싼다.

export const RANKING_ROWS = 10;

// YYYY-MM-DD / HH:MM (브라우저 로컬 시각 기준) - 마이페이지 누적 기록 탭과 동일한 표기.
export function formatDateTime(isoString) {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} / ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function fetchGameRanking(gameType) {
  const data = await fetch(`/api/mypage/ranking?game_type=${gameType}`).then((res) => res.json());
  return data.records;
}

// currentUserId를 넘기면 그 행에 ranking-row-me 클래스를 붙여 본인 순위를
// 강조한다 - 게임 결과창에서만 쓰고, 마이페이지 랭킹 탭은 생략해 기존과 동일하게 둔다.
export function renderRankingTable(container, records, { rows = RANKING_ROWS, currentUserId = null } = {}) {
  const rowsHtml = [];
  for (let i = 0; i < rows; i++) {
    const record = records[i];
    if (!record) {
      rowsHtml.push(`<tr class="ranking-empty-row"><td>-</td><td>-</td><td>-</td></tr>`);
      continue;
    }
    const isMe = currentUserId != null && record.user_id === currentUserId;
    const rowClass = isMe ? ` class="ranking-row-me"` : "";
    rowsHtml.push(
      `<tr${rowClass}><td>${record.user_id}</td><td>${record.score}점</td><td class="ranking-date-col">${formatDateTime(record.played_at)}</td></tr>`,
    );
  }

  container.innerHTML =
    `<table class="ranking-table"><thead><tr>` +
    `<th>회원 번호</th><th>게임 점수</th><th>게임 플레이 일시</th>` +
    `</tr></thead><tbody>${rowsHtml.join("")}</tbody></table>`;
}
