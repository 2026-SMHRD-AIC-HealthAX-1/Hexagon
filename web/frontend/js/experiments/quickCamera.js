import { storePendingPhoto } from "../pendingPhoto.js";

// [보관용 - 어디에서도 import하지 않음. 2026-09-17]
//
// input[type=file]에 capture 속성을 붙여 "시스템 카메라 앱"을 직접 띄우는 방식.
// 현재 퀵메뉴의 "사진 촬영"(js/cameraCapture.js)은 이 방식 대신 getUserMedia로
// 페이지 안에서 미리보기를 띄우고 프레임을 캡처한다 - capture 속성이 데스크톱
// 브라우저에서는 무시되어 PC에서 촬영이 아예 불가능했기 때문이다(스펙상 모바일
// 전용 힌트라 버그가 아님).
//
// 그래도 지우지 않고 남겨두는 이유: 모바일에서는 이 방식이 OS의 정식 카메라
// 앱(자동 초점, 고해상도)을 띄워서 getUserMedia로 캔버스에 뽑은 프레임보다 사진
// 품질이 낫다. 백내장 모델 입력 품질이 문제가 되면 "모바일에서는 이 방식,
// 데스크톱에서는 getUserMedia"로 갈라 쓰는 선택지가 남아 있다.
//
// 사진을 IndexedDB(../pendingPhoto.js)에 담아 analysis.html?mode=pending으로
// 넘기는 뒷부분은 현재 라이브 코드와 동일한 방식이라 그대로 재사용 가능하다.
export function initQuickCameraFab(fabId, inputId) {
  const fab = document.getElementById(fabId);
  const input = document.getElementById(inputId);
  if (!fab || !input) return;

  fab.addEventListener("click", () => {
    input.value = "";
    input.click();
  });

  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;

    try {
      await storePendingPhoto(file);
    } catch (error) {
      alert("사진을 분석 페이지로 전달하지 못했습니다. 다시 시도해주세요.");
      return;
    }

    location.href = "analysis.html?mode=pending";
  });
}
