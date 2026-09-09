import { requireLogin, syncAuthWithServer } from "./auth.js";

await syncAuthWithServer();
requireLogin();

const fileInput = document.getElementById("photo-input");
const preview = document.getElementById("preview");
const loading = document.getElementById("loading");
const result = document.getElementById("result");

// 홈 화면의 퀵메뉴에서 "사진 촬영"으로 들어온 경우 갤러리 대신 카메라를 바로 띄운다.
// capture 속성은 모바일 브라우저에서 갤러리 대신 카메라 앱을 직접 연다.
// 단, 페이지 이동 직후에는 브라우저가 파일 선택창의 자동 실행(click())을 막을 수 있어
// "사진 선택" 버튼 문구를 "카메라로 촬영하기"로 바꿔 한 번 더 탭하면 확실히 열리게 해둔다.
if (new URLSearchParams(location.search).get("mode") === "capture") {
  fileInput.setAttribute("capture", "environment");
  document.getElementById("photo-input-label-text").textContent = "카메라로 촬영하기";
  fileInput.click();
}

// AI 모델이 아직 없으므로 업로드 UI/화면 전환 흐름만 만들어두는 틀(scaffold)이다.
// 실제 업로드 전송이나 분석 로직은 없고, 잠깐의 로딩 후 "준비 중" 안내만 표시한다.
fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";

  loading.classList.remove("hidden");
  result.classList.add("hidden");

  setTimeout(() => {
    loading.classList.add("hidden");
    result.classList.remove("hidden");
  }, 900);
});
