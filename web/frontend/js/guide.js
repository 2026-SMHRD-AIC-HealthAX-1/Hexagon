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

/*
  게임 시작 전 "기존 캘리브레이션으로 진행할지" 묻는 것처럼, 버튼이 여러 개고
  어떤 버튼을 눌렀는지가 중요한 모달용. showGuide() 와 표시/숨김 방식은
  같지만 여러 버튼 중 하나의 값을 돌려준다는 점만 다르다 - game.js,
  rhythm_game.js 가 같은 방식으로 쓴다.
*/
export function showChoice(modalEl, choices) {
  return new Promise((resolve) => {
    modalEl.classList.remove("hidden");

    function cleanup() {
      modalEl.classList.add("hidden");
      choices.forEach(({ button, handler }) => button.removeEventListener("click", handler));
    }

    for (const choice of choices) {
      choice.handler = () => {
        cleanup();
        resolve(choice.value);
      };
      choice.button.addEventListener("click", choice.handler);
    }
  });
}
