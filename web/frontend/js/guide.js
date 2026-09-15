/*
  게임 시작 전 안내 모달을 보여주고, 사용자가 확인 버튼을 누를 때까지
  기다린다. 모달 자체는 각 페이지의 정적 HTML(<div class="modal hidden">)로
  이미 있고, 이 함수는 표시/숨김과 버튼 클릭 대기만 담당한다 - game.js,
  game_lab.js, rhythm_game.js, rhythm_game_lab.js 네 진입점이 모두 같은
  방식으로 쓴다.
*/
export function showGuide(modalEl, confirmBtn) {
  return new Promise((resolve) => {
    modalEl.classList.remove("hidden");

    function onConfirm() {
      modalEl.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      resolve();
    }

    confirmBtn.addEventListener("click", onConfirm);
  });
}
