import { storePendingPhoto } from "./pendingPhoto.js";
import { capturePhotoWithCamera } from "./cameraCapture.js";

// 홈/마이페이지 우측 하단 퀵메뉴(FAB). index.html과 mypage.html이 같은 마크업을
// 쓰므로 동작도 여기 한 곳에만 둔다.
//
// 흐름: FAB 클릭 -> "사진 선택"/"사진 촬영" 노출(이때 FAB 자체는 "닫기" 버튼이
// 된다) -> 각 버튼이 파일 선택창/카메라를 이 페이지에서 바로 연다 -> 사진이
// 정해지면 analysis.html로 넘겨 분석 결과까지 이어서 보여준다.
//
// analysis.html로 페이지를 먼저 이동시킨 뒤 거기서 파일을 고르게 하지 않는 이유:
// 파일 선택창/카메라는 사용자 클릭(신뢰된 제스처) 안에서 바로 열어야 브라우저가
// 막지 않기 때문이다. 페이지 이동 후 자동으로 열려고 하면 브라우저가 차단할 수
// 있어서 예전 analysis.html?mode=capture 방식은 "한 번 더 눌러주세요" 안내를
// 둬야 했다.
export function initQuickPhotoMenu() {
  const fab = document.getElementById("quick-fab");
  const menu = document.getElementById("quick-menu");
  const pickBtn = document.getElementById("quick-pick-btn");
  const captureBtn = document.getElementById("quick-capture-btn");
  const fileInput = document.getElementById("quick-photo-input");

  function setMenuOpen(open) {
    menu.classList.toggle("show", open);
    fab.classList.toggle("is-open", open);
    fab.setAttribute("aria-label", open ? "메뉴 닫기" : "눈 검사 메뉴");
  }

  fab.addEventListener("click", () => {
    setMenuOpen(!menu.classList.contains("show"));
  });

  pickBtn.addEventListener("click", () => {
    // 같은 사진을 다시 골라도 change가 나도록 매번 비운다.
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) goToAnalysis(file);
  });

  captureBtn.addEventListener("click", async () => {
    const file = await capturePhotoWithCamera();
    if (file) goToAnalysis(file);
  });
}

// File은 URL 파라미터로 넘길 수 없으므로 IndexedDB에 잠깐 넣어두고
// analysis.html이 꺼내 쓰게 한다 (pendingPhoto.js / analysis.js 참고).
async function goToAnalysis(file) {
  try {
    await storePendingPhoto(file);
  } catch (error) {
    alert("사진을 분석 페이지로 전달하지 못했습니다. 다시 시도해주세요.");
    return;
  }
  location.href = "analysis.html?mode=pending";
}
