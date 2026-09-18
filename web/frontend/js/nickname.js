// 최초 로그인 시 닉네임을 강제로 설정시키는 모달. 로그인이 필요한 모든 화면의
// 진입 스크립트가 requireLogin() 직후 await ensureNickname()을 호출한다 -
// 이 함수가 반환하는 프로미스는 닉네임이 이미 있거나(또는 비로그인) 즉시
// resolve되고, 없으면 모달을 제출할 때까지 resolve되지 않는다. 최상단
// await로 호출하는 각 페이지 스크립트에서, 그 뒤에 오는 코드(웹캠 동의창
// 표시 등)가 전부 이 프로미스가 끝난 뒤에야 실행되므로 자연히 다른 모달보다
// 먼저 뜬다.
//
// 모달 DOM은 cameraCapture.js와 같은 방식으로 여기서 만들었다 지운다 - 취소
// 버튼은 없다(닉네임 없이는 넘어갈 수 없는 필수 입력이라는 요구사항).
// 스타일은 기존 .modal/.modal-box/.modal-actions를 그대로 재사용해서 페이지마다
// (사이트 기본/두더지 사냥/리듬게임) 각자의 테마를 자동으로 따라간다 -
// .modal-input/.modal-error만 각 테마 CSS에 새로 추가했다.

import { getAuth, setStoredNickname } from "./auth.js";

const NICKNAME_MAX_LENGTH = 20;

function buildModal() {
  const modal = document.createElement("div");
  // neon-modal은 리듬게임 페이지(rhythm_game_theme.css)의 네온 오버레이/모달박스
  // 스타일을 켜는 클래스 - 그 클래스를 정의하지 않는 다른 페이지에서는 그냥
  // 무시되므로, 페이지별로 분기하지 않고 항상 붙여도 안전하다.
  modal.className = "modal neon-modal";
  modal.innerHTML = `
    <div class="modal-box wide-modal">
      <h2>닉네임을 설정해주세요</h2>
      <p>게임 랭킹과 눈 건강 요약에 표시될 닉네임입니다.</p>
      <input type="text" class="modal-input" maxlength="${NICKNAME_MAX_LENGTH}" placeholder="닉네임 입력" autocomplete="off">
      <div class="modal-error hidden"></div>
      <div class="modal-actions">
        <button type="button" class="primary" data-action="submit">확인</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

export function ensureNickname() {
  const auth = getAuth();
  if (!auth || auth.nickname) return Promise.resolve();

  return new Promise((resolve) => {
    const modal = buildModal();
    const input = modal.querySelector("input");
    const errorBox = modal.querySelector(".modal-error");
    const submitBtn = modal.querySelector('[data-action="submit"]');

    function showError(message) {
      errorBox.textContent = message;
      errorBox.classList.remove("hidden");
    }

    async function submit() {
      const nickname = input.value.trim();
      if (!nickname) {
        showError("닉네임을 입력해주세요.");
        return;
      }
      if (nickname.length > NICKNAME_MAX_LENGTH) {
        showError(`닉네임은 ${NICKNAME_MAX_LENGTH}자 이하로 입력해주세요.`);
        return;
      }

      submitBtn.disabled = true;
      try {
        const res = await fetch("/api/auth/nickname", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname }),
        });
        const data = await res.json();

        if (!res.ok) {
          showError(data.detail || "닉네임 설정에 실패했습니다.");
          submitBtn.disabled = false;
          return;
        }

        setStoredNickname(data.nickname);
        modal.remove();
        resolve();
      } catch (err) {
        showError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
        submitBtn.disabled = false;
      }
    }

    submitBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });

    input.focus();
  });
}
