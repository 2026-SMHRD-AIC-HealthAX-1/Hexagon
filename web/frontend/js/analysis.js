import { requireLogin, syncAuthWithServer } from "./auth.js";

await syncAuthWithServer();
requireLogin();

const fileInput = document.getElementById("photo-input");
const preview = document.getElementById("preview");
const loading = document.getElementById("loading");
const result = document.getElementById("result");
const errorBox = document.getElementById("error");
const cataractValue = document.getElementById("cataract-value");
const rednessValue = document.getElementById("redness-value");
const retryBtn = document.getElementById("retry-btn");
const homeBtn = document.getElementById("home-btn");

// 홈 화면의 퀵메뉴에서 "사진 촬영"으로 들어온 경우 갤러리 대신 카메라를 바로 띄운다.
// capture 속성은 모바일 브라우저에서 갤러리 대신 카메라 앱을 직접 연다.
// 단, 페이지 이동 직후에는 브라우저가 파일 선택창의 자동 실행(click())을 막을 수 있어
// "사진 선택" 버튼 문구를 "카메라로 촬영하기"로 바꿔 한 번 더 탭하면 확실히 열리게 해둔다.
if (new URLSearchParams(location.search).get("mode") === "capture") {
  fileInput.setAttribute("capture", "environment");
  document.getElementById("photo-input-label-text").textContent = "카메라로 촬영하기";
  fileInput.click();
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

// 사진 파일을 multipart가 아니라 요청 본문에 그대로 실어 보낸다 - 서버가 원본을
// 디스크에 남기지 않고 메모리에서만 처리하기 위한 것 (web/backend/routers/analysis.py).
async function analyzePhoto(file) {
  const response = await fetch("/api/analysis", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail || "분석에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }
  return response.json();
}

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";

  loading.classList.remove("hidden");
  result.classList.add("hidden");
  errorBox.classList.add("hidden");

  try {
    const data = await analyzePhoto(file);

    if (!data.ok) {
      showError(data.message);
      return;
    }

    cataractValue.textContent =
      `${(data.cataract_prob * 100).toFixed(1)}% · ${data.cataract_label}`;
    rednessValue.textContent = `${(data.redness_ratio * 100).toFixed(1)}%`;
    result.classList.remove("hidden");
  } catch (error) {
    showError(error.message);
  } finally {
    loading.classList.add("hidden");
  }
});

retryBtn.addEventListener("click", () => {
  URL.revokeObjectURL(preview.src);
  preview.removeAttribute("src");
  preview.style.display = "none";

  // 같은 사진을 다시 고르는 경우에도 change 이벤트가 나도록 값을 비워둔다.
  fileInput.value = "";

  result.classList.add("hidden");
  errorBox.classList.add("hidden");
});

homeBtn.addEventListener("click", () => {
  location.href = "index.html";
});
