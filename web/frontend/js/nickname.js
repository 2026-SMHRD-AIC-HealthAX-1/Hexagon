// 최초 로그인 시 닉네임 설정 + 데이터 수집 동의를 강제로 받는 모달. 로그인이
// 필요한 모든 화면의 진입 스크립트가 requireLogin() 직후 await ensureNickname()을
// 호출한다 - 이 함수가 반환하는 프로미스는 닉네임/동의가 이미 모두 있거나(또는
// 비로그인) 즉시 resolve되고, 그렇지 않으면 모달을 제출할 때까지 resolve되지
// 않는다. 최상단 await로 호출하는 각 페이지 스크립트에서, 그 뒤에 오는 코드(웹캠
// 동의창 표시 등)가 전부 이 프로미스가 끝난 뒤에야 실행되므로 자연히 다른
// 모달보다 먼저 뜬다.
//
// 두 가지 경우를 구분한다:
// - 닉네임이 아예 없는 최초 로그인: 닉네임 입력 + 데이터 수집 동의를 한 모달에서
//   같이 받는다(POST /api/auth/nickname). 동의 없이는 제출 자체가 안 된다.
// - 닉네임은 이미 있지만(이 기능 추가 전 가입한 기존 사용자) 동의 기록이 없는
//   경우: 닉네임 재입력 없이 동의만 받는다(POST /api/auth/consent).
// 두 경우 모두 동의해야만 다음으로 넘어갈 수 있다 - "동의할 경우에만 서비스
// 이용 가능"이 요구사항이라, 취소 버튼은 없다.
//
// 모달 DOM은 cameraCapture.js와 같은 방식으로 여기서 만들었다 지운다. 스타일은
// 기존 .modal/.modal-box/.modal-actions를 그대로 재사용해서 페이지마다(사이트
// 기본/두더지 사냥/리듬게임) 각자의 테마를 자동으로 따라간다 - .modal-input/
// .modal-error/.modal-consent-*만 각 테마 CSS에 새로 추가했다.

import { getAuth, setStoredNickname, setStoredDataConsent } from "./auth.js";

const NICKNAME_MAX_LENGTH = 20;

// 두 모달(닉네임+동의 / 동의만) 공통으로 들어가는 동의 안내 블록 - 무엇을
// 저장하는지 구체적으로 나열해야 "동의"라는 이름에 값하므로, DB에 실제로 쌓이는
// 항목만 그대로 적는다(db.py의 game_records/blink_alerts/analysis_results).
function consentBlockHtml() {
  return `
    <div class="modal-consent">
      <ul class="modal-consent-list">
        <li>미니게임 · 리듬게임 점수 기록</li>
        <li>눈 깜빡임 저하 경고 발생 기록</li>
        <li>사진 분석 결과(백내장 위험도, 안구 충혈도) 수치</li>
      </ul>
      <label class="modal-consent-check">
        <input type="checkbox" class="modal-consent-checkbox">
        <span>위 정보 수집 및 저장에 동의합니다. (필수)</span>
      </label>
    </div>
  `;
}

function buildModal(innerHtml) {
  const modal = document.createElement("div");
  // neon-modal은 리듬게임 페이지(rhythm_game_theme.css)의 네온 오버레이/모달박스
  // 스타일을 켜는 클래스 - 그 클래스를 정의하지 않는 다른 페이지에서는 그냥
  // 무시되므로, 페이지별로 분기하지 않고 항상 붙여도 안전하다.
  modal.className = "modal neon-modal";
  modal.innerHTML = `<div class="modal-box wide-modal">${innerHtml}</div>`;
  document.body.appendChild(modal);
  return modal;
}

// 공통 제출 처리: 체크박스 확인 -> API 호출 -> 실패 시 에러 표시, 성공 시
// 캐시 갱신 후 모달 제거 + resolve. request()는 실제 fetch를 감싼 함수로,
// 두 모달이 서로 다른 엔드포인트/바디를 쓰기 때문에 인자로 받는다.
function wireSubmit(modal, resolve, { validate, request, onSuccess }) {
  const errorBox = modal.querySelector(".modal-error");
  const submitBtn = modal.querySelector('[data-action="submit"]');
  const checkbox = modal.querySelector(".modal-consent-checkbox");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  }

  async function submit() {
    const validationError = validate();
    if (validationError) {
      showError(validationError);
      return;
    }
    if (!checkbox.checked) {
      showError("데이터 수집 및 저장에 동의해야 서비스를 이용할 수 있습니다.");
      return;
    }

    submitBtn.disabled = true;
    try {
      const res = await request();
      const data = await res.json();

      if (!res.ok) {
        showError(data.detail || "처리에 실패했습니다.");
        submitBtn.disabled = false;
        return;
      }

      onSuccess(data);
      modal.remove();
      resolve();
    } catch (err) {
      showError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      submitBtn.disabled = false;
    }
  }

  submitBtn.addEventListener("click", submit);
  return submit;
}

// 최초 로그인(닉네임 없음): 닉네임 입력 + 데이터 수집 동의를 한 모달에서 같이 받는다.
function showNicknameAndConsentModal(resolve) {
  const modal = buildModal(`
    <h2>닉네임을 설정해주세요</h2>
    <p>게임 랭킹과 눈 건강 요약에 표시될 닉네임입니다.</p>
    <input type="text" class="modal-input" maxlength="${NICKNAME_MAX_LENGTH}" placeholder="닉네임 입력" autocomplete="off">
    ${consentBlockHtml()}
    <div class="modal-error hidden"></div>
    <div class="modal-actions">
      <button type="button" class="primary" data-action="submit">확인</button>
    </div>
  `);
  const input = modal.querySelector("input.modal-input");

  const submit = wireSubmit(modal, resolve, {
    validate() {
      const nickname = input.value.trim();
      if (!nickname) return "닉네임을 입력해주세요.";
      if (nickname.length > NICKNAME_MAX_LENGTH) return `닉네임은 ${NICKNAME_MAX_LENGTH}자 이하로 입력해주세요.`;
      return null;
    },
    request() {
      return fetch("/api/auth/nickname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: input.value.trim(), consent: true }),
      });
    },
    onSuccess(data) {
      setStoredNickname(data.nickname);
      setStoredDataConsent();
    },
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
  input.focus();
}

// 닉네임은 이미 있지만(기존 사용자) 동의 기록이 없는 경우: 동의만 받는다.
function showConsentOnlyModal(resolve) {
  const modal = buildModal(`
    <h2>서비스 이용 동의가 필요합니다</h2>
    <p>계속 이용하시려면 아래 정보 수집 및 저장에 동의해주세요.</p>
    ${consentBlockHtml()}
    <div class="modal-error hidden"></div>
    <div class="modal-actions">
      <button type="button" class="primary" data-action="submit">동의하고 계속하기</button>
    </div>
  `);

  wireSubmit(modal, resolve, {
    validate() {
      return null;
    },
    request() {
      return fetch("/api/auth/consent", { method: "POST" });
    },
    onSuccess() {
      setStoredDataConsent();
    },
  });
}

export function ensureNickname() {
  const auth = getAuth();
  if (!auth) return Promise.resolve();
  if (auth.nickname && auth.dataConsent) return Promise.resolve();

  return new Promise((resolve) => {
    if (!auth.nickname) {
      showNicknameAndConsentModal(resolve);
    } else {
      showConsentOnlyModal(resolve);
    }
  });
}
