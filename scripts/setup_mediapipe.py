"""
브라우저용 MediaPipe 자산을 web/frontend/vendor/mediapipe/ 에 내려받는다.

왜 필요한가:
    시선/깜빡임 계산을 서버 파이썬에서 브라우저 JS로 옮기려면, 브라우저가
    MediaPipe 엔진(WASM)과 얼굴 랜드마크 모델을 직접 가지고 있어야 한다.
    이 파일들은 용량이 커서(WASM 약 34MB) 저장소에 커밋하지 않고,
    각자 이 스크립트로 로컬에 준비한다. 한 번 받아두면 이후에는 인터넷 없이
    동작한다 - CDN 을 쓰지 않기로 한 이유는 rhythm_new.txt 와
    python_to_js.txt 참고.

사용법 (프로젝트 루트에서, 표준 라이브러리만 쓰므로 가상환경도 불필요):
    python scripts/setup_mediapipe.py

이미 받아둔 상태면 다시 받지 않는다. 강제로 다시 받으려면:
    python scripts/setup_mediapipe.py --force
"""
import argparse
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

# 버전을 고정해둔다 - 올릴 때는 이 값만 바꾸고 --force 로 다시 받으면 된다.
PACKAGE_VERSION = "1.0.1"
TARBALL_URL = (
    "https://registry.npmjs.org/@mediapipe/tasks-vision/-/"
    f"tasks-vision-{PACKAGE_VERSION}.tgz"
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VENDOR_DIR = PROJECT_ROOT / "web" / "frontend" / "vendor" / "mediapipe"
MODEL_SRC = PROJECT_ROOT / "models" / "face_landmarker.task"


def human(num_bytes):
    return f"{num_bytes / 1024 / 1024:.1f}MB"


def already_installed():
    return (
        (VENDOR_DIR / "vision_bundle.mjs").is_file()
        and (VENDOR_DIR / "wasm" / "vision_wasm_internal.wasm").is_file()
        and (VENDOR_DIR / "face_landmarker.task").is_file()
    )


def download_and_extract():
    VENDOR_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        tarball = tmp_path / "tasks-vision.tgz"

        print(f"[1/3] @mediapipe/tasks-vision {PACKAGE_VERSION} 다운로드 중...")
        urllib.request.urlretrieve(TARBALL_URL, tarball)
        print(f"      받음: {human(tarball.stat().st_size)}")

        print("[2/3] 압축 해제 및 배치")
        with tarfile.open(tarball) as tar:
            members = [
                m for m in tar.getmembers()
                if m.name.startswith("package/wasm/") or m.name == "package/vision_bundle.mjs"
            ]
            # filter="data" 는 파이썬 3.12+ 에서 권장되는 안전한 추출 방식이다.
            # (지정하지 않으면 3.14 부터 에러가 난다)
            tar.extractall(tmp_path, members=members, filter="data")

        extracted = tmp_path / "package"

        # JS 라이브러리 본체
        shutil.copy2(extracted / "vision_bundle.mjs", VENDOR_DIR / "vision_bundle.mjs")

        # WASM 엔진. SIMD 지원 여부에 따라 브라우저가 다른 파일을 요청하므로
        # 폴더를 통째로 둔다 (어떤 변형이 요청되든 404 가 나지 않게).
        wasm_dest = VENDOR_DIR / "wasm"
        if wasm_dest.exists():
            shutil.rmtree(wasm_dest)
        shutil.copytree(extracted / "wasm", wasm_dest)


def copy_model():
    print("[3/3] 얼굴 랜드마크 모델 복사")

    if not MODEL_SRC.is_file():
        raise SystemExit(
            f"모델 파일이 없습니다: {MODEL_SRC}\n"
            "저장소에 포함된 파일이니, clone 이 제대로 됐는지 확인해주세요."
        )

    # 브라우저는 web/frontend/ 아래만 받아볼 수 있는데(app.py 의 StaticFiles 마운트)
    # 모델 원본은 저장소 루트의 models/ 에 있으므로 여기로 복사해둔다.
    # 원본이 갱신되면 이 스크립트를 --force 로 다시 돌리면 된다.
    shutil.copy2(MODEL_SRC, VENDOR_DIR / "face_landmarker.task")


def main():
    parser = argparse.ArgumentParser(description="브라우저용 MediaPipe 자산 설치")
    parser.add_argument("--force", action="store_true", help="이미 설치돼 있어도 다시 받기")
    args = parser.parse_args()

    if already_installed() and not args.force:
        print(f"이미 설치되어 있습니다: {VENDOR_DIR}")
        print("다시 받으려면 --force 를 붙여 실행하세요.")
        return

    download_and_extract()
    copy_model()

    total = sum(f.stat().st_size for f in VENDOR_DIR.rglob("*") if f.is_file())
    print()
    print(f"완료: {VENDOR_DIR}  (총 {human(total)})")
    print("이 폴더는 .gitignore 처리되어 있어 저장소에는 올라가지 않습니다.")


if __name__ == "__main__":
    main()
