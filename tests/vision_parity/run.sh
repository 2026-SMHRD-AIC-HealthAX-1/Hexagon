#!/bin/bash
# src/ 의 파이썬 계산 로직과 web/frontend/js/vision/ 의 JS 포팅본이
# 같은 입력에 같은 숫자를 내는지 검증한다.
#
# 사용법 (프로젝트 루트에서):
#     ./tests/vision_parity/run.sh
#
# 파이썬 -> JS 포팅은 예외를 던지지 않고 "그럴듯한 오답"을 내기 쉬워서
# (특히 gazeRegionClassifier 의 튜플 키/정렬 순서), 로직을 고칠 때마다
# 이걸 돌려서 두 언어가 안 갈라졌는지 확인할 것.
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
rm -rf "$HERE/vision"
mkdir -p "$HERE/vision"
cp "$ROOT/web/frontend/js/vision/"*.js "$HERE/vision/"

echo "[3/3] 비교 실행"
echo ""
cd "$HERE"
node compare.mjs
