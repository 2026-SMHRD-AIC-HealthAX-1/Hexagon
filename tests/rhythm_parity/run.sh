#!/bin/bash
# 서버 리듬게임 로직(web/backend/sessions/rhythm_game_session.py)과
# JS 포팅본(web/frontend/js/rhythm/gameEngine.js)이 같은 입력에 같은 판정을
# 내는지 검증한다.
#
# 사용법 (프로젝트 루트에서):
#     ./tests/rhythm_parity/run.sh
#
# 두 구현의 상수(낙하 3000ms, PERFECT 150ms, CATCH 400ms 등)나 판정 규칙을
# 한쪽만 고치면 난이도가 조용히 갈라지므로, 로직 수정 후엔 이걸 돌려볼 것.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

cd "$ROOT"

if [ -d "eye" ]; then
  # shellcheck disable=SC1091
  source eye/bin/activate
fi

echo "[1/3] 파이썬 기준값 생성"
python "$HERE/gen_expected.py"

echo "[2/3] JS 모듈 복사"
# node 는 package.json 이 없는 .js 를 CommonJS 로 읽어서 import/export 가 깨진다.
# 원본을 건드리지 않기 위해, ESM 으로 선언된 이 폴더로 복사해서 돌린다.
rm -rf "$HERE/rhythm"
mkdir -p "$HERE/rhythm"
cp "$ROOT/web/frontend/js/rhythm/gameEngine.js" "$HERE/rhythm/"

echo "[3/3] 비교 실행"
echo ""
cd "$HERE"
node compare.mjs
