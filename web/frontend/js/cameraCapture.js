// 퀵메뉴 "사진 촬영"에서 쓰는 카메라 촬영 UI.
//
// input[type=file]의 capture 속성 대신 getUserMedia를 쓰는 이유: capture 속성은
// 모바일 브라우저에서만 동작하고 데스크톱에서는 그냥 파일 선택창이 떠서 PC에서는
// "촬영"이 아예 불가능했다(2026-09-17에 그 방식으로 한 번 만들었다가 되돌린 이력 -
// js/experiments/quickCamera.js). getUserMedia는 PC 웹캠/모바일 카메라 모두에서
// 동작하므로 한 가지 구현으로 두 환경을 다 덮는다.
//
// 주의: getUserMedia는 보안 컨텍스트(https 또는 localhost)에서만 동작한다. 지금은
// http://localhost로 돌리므로 문제없지만, 실제 도메인에 배포할 때는 https가 필수다.
//
// 모달 DOM은 여기서 만들었다 지운다 - index.html/mypage.html 두 곳에 같은 마크업을
// 복붙하지 않기 위함이고(이 프로젝트엔 템플릿 엔진이 없다), 매번 새로 만들어서
// 이전 촬영 상태가 남지 않게 하기 위함이다. 스타일은 기존 .modal/.modal-box/
// .modal-actions(게임 화면의 웹캠 동의 팝업과 동일)을 그대로 재사용한다.

function buildModal(innerHtml) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `<div class="modal-box wide-modal">${innerHtml}</div>`;
  document.body.appendChild(modal);
  return modal;
}

// 촬영 전 웹캠 사용 동의 - 브라우저 자체 권한 팝업이 뜨기 전에 무엇에 쓰는지
// 먼저 알린다(게임 화면의 #consent-modal과 같은 흐름).
function askCameraConsent() {
  return new Promise((resolve) => {
    const modal = buildModal(`
      <h2>카메라를 사용하여 사진을 촬영할까요?</h2>
      <p>
        사진 촬영을 위해 카메라(웹캠) 접근 권한이 필요합니다.<br>
        촬영한 사진은 분석에만 사용되며 서버에 저장되지 않습니다.
      </p>
      <div class="modal-actions">
        <button type="button" data-action="cancel">취소</button>
        <button type="button" class="primary" data-action="confirm">확인</button>
      </div>
    `);

    modal.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (!action) return;
      modal.remove();
      resolve(action === "confirm");
    });
  });
}

// 실제 촬영 화면. 촬영하면 File, 취소하면 null을 돌려준다.
function showCameraModal(stream) {
  return new Promise((resolve) => {
    const modal = buildModal(`
      <h2>사진 촬영</h2>
      <video class="camera-preview" autoplay playsinline muted></video>
      <p>눈이 화면 가운데에 오도록 맞춘 뒤 촬영 버튼을 눌러주세요.</p>
      <div class="modal-actions">
        <button type="button" data-action="cancel">취소</button>
        <button type="button" class="primary" data-action="shoot">촬영</button>
      </div>
    `);

    const video = modal.querySelector("video");
    video.srcObject = stream;

    modal.addEventListener("click", async (event) => {
      const action = event.target.dataset.action;
      if (!action) return;

      if (action === "cancel") {
        modal.remove();
        resolve(null);
        return;
      }

      // videoWidth는 메타데이터가 로드되기 전까지 0이다 - 미리보기가 보이는
      // 상태에서 누르는 버튼이라 정상적으로는 이미 로드돼 있지만, 혹시 0이면
      // 빈 이미지를 만들어 보내지 않도록 그냥 무시한다.
      if (!video.videoWidth) return;

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);

      const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.92));
      modal.remove();
      resolve(blob ? new File([blob], "eye-capture.jpg", { type: "image/jpeg" }) : null);
    });
  });
}

// 동의 -> 카메라 열기 -> 촬영까지의 전체 흐름. 촬영된 File, 또는 취소/실패 시 null.
export async function capturePhotoWithCamera() {
  if (!(await askCameraConsent())) return null;

  let stream;
  try {
    // facingMode는 힌트라서 웹캠 하나뿐인 PC에서는 무시된다 - 모바일에서만
    // 후면 카메라가 우선 선택된다(analysis.html?mode=capture의 기존 설정과 동일).
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch (error) {
    alert("카메라를 사용할 수 없습니다. 브라우저의 카메라 권한을 확인해주세요.");
    return null;
  }

  try {
    return await showCameraModal(stream);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
