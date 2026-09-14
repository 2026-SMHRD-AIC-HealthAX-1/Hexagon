#!/bin/bash
# 서버 시선추적 미니게임 로직(calibration_session.py + game_session.py)과
# JS 포팅본(web/frontend/js/gaze/calibrationEngine.js, gameEngine.js)이
# 같은 입력에 같은 결과를 내는지 검증한다.
#
# 사용법 (프로젝트 루트에서):
#     ./tests/gaze_parity/run.sh
#
# 두 구현의 상수(캘리브레이션 9포인트 타이밍, 제한시간 30초, 응시 유지 0.5초
# 등)나 판정 규칙을 한쪽만 고치면 조용히 갈라지므로, 로직 수정 후엔 이걸 돌려볼 것.
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
rm -rf "$HERE/gaze" "$HERE/vision"
mkdir -p "$HERE/gaze" "$HERE/vision"
cp "$ROOT/web/frontend/js/gaze/calibrationEngine.js" "$ROOT/web/frontend/js/gaze/gameEngine.js" "$HERE/gaze/"
cp "$ROOT/web/frontend/js/vision/gazeRegionClassifier.js" "$HERE/vision/"

echo "[3/3] 비교 실행"
echo ""
cd "$HERE"
node compare.mjs
