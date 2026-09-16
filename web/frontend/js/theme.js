/*
  서비스 전체 다크모드 설정.

  실제 테마 전환 자체(라이트<->다크 CSS 변수)는 css/style.css의
  :root[data-theme="dark"]가 담당한다 - 이 모듈은 그 data-theme 속성을
  localStorage와 동기화하는 역할만 한다.

  "로그아웃 하기 전까지는 계속 유지"가 요구사항이라 세션스토리지가 아니라
  localStorage를 쓴다(페이지 이동/새로고침/브라우저 재시작에도 유지) - 대신
  로그아웃 시점에 auth.js의 logout()이 clearStoredTheme()을 호출해 지운다.

  깜빡임(FOUC) 방지: 이 모듈은 각 페이지의 <script type="module">이 문서 파싱이
  끝난 뒤에야 실행되므로, 그걸 기다리면 첫 페인트가 라이트 테마로 한 번 그려졌다가
  다크로 바뀌는 게 보일 수 있다. 그래서 실제 최초 적용은 각 HTML 파일 맨 앞의
  동기 인라인 <script>가 이 모듈과 별개로 직접 처리한다 - 이 모듈의 initTheme()은
  그 인라인 스크립트가 없는 환경(예: 테스트)을 위한 안전망 성격이다.
*/

const STORAGE_KEY = "eyeGodTheme";

export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

export function setStoredTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage를 못 쓰는 환경(프라이빗 모드 등) - 이번 페이지 로드에서만
    // 적용되고 저장은 안 되지만 치명적이지 않으므로 조용히 넘어간다.
  }
  applyTheme(theme);
}

export function clearStoredTheme() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 위와 동일한 이유로 무시
  }
  applyTheme("light");
}

export function initTheme() {
  applyTheme(getStoredTheme());
}

export function toggleTheme() {
  const next = getStoredTheme() === "dark" ? "light" : "dark";
  setStoredTheme(next);
  return next;
}
