"""눈 사진 한 장 -> 백내장 위험도 + 충혈도 end-to-end 분석 파이프라인.

AI/AI_Flow.txt 0번 섹션의 구조를 그대로 구현한다 - 사진 한 장에 eye_seg를
**한 번만** 돌리고, 거기서 나온 마스크 2개를 각자 다른 용도로 나눠 쓴다:

    눈 사진
      -> eye_seg (models/eye_seg/eye_seg.pt)
           |
           +-- 공막(sclera) 영역 -----> 충혈도: 영역 내 붉은 픽셀 비율
           |
           +-- 홍채+동공(iris_pupil) -> 크롭 -> 백내장 분류 (best.pt)

둘 중 하나라도 검출되지 않으면 분석하지 않고 재촬영을 요구한다.

계산 로직 자체는 기존 스크립트에서 그대로 가져다 쓴다 (같은 로직을 두 벌
유지하지 않기 위함):
  - 크롭: AI/scripts/crop_iris_pupil.py (학습 데이터를 만들 때 쓴 것과
    **동일한** 크롭 기준을 써야 정확도가 유지된다 - AI_Flow.txt 3번 섹션)
  - 충혈도: models/eye_seg/redness_ratio.py
  - 백내장 판정 구간: models/cataract_cls/infer.py

사용법 (ultralytics, opencv-python 설치 필요):
    python models/eye_analysis.py --image 눈사진.jpg
"""
import argparse
import sys
from pathlib import Path

import cv2
from ultralytics import YOLO

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EYE_SEG_DIR = PROJECT_ROOT / "models" / "eye_seg"
CATARACT_DIR = PROJECT_ROOT / "models" / "cataract_cls"
AI_SCRIPTS_DIR = PROJECT_ROOT / "AI" / "scripts"

# 이 저장소 관례상 각 폴더의 모듈들이 패키지가 아니라 평면(flat) 임포트라
# 경로를 직접 추가해서 가져온다 (CLAUDE.md "Known quirks in src/" 참고).
for _path in (EYE_SEG_DIR, CATARACT_DIR, AI_SCRIPTS_DIR):
    sys.path.insert(0, str(_path))

from crop_iris_pupil import (  # noqa: E402
    IMG_SIZE as SEG_IMG_SIZE,
    PADDING_RATIO,
    find_best_iris_pupil_box,
    pad_and_clip_box,
)
from infer import (  # noqa: E402
    IMG_SIZE as CLS_IMG_SIZE,
    cataract_probability,
    classify_risk,
)
from redness_ratio import red_pixel_mask, union_sclera_mask  # noqa: E402

SEG_WEIGHTS = EYE_SEG_DIR / "eye_seg.pt"
CLS_WEIGHTS = CATARACT_DIR / "best.pt"

_models = {}


def _load_model(weights: Path) -> YOLO:
    """가중치를 한 번만 읽어서 재사용한다 - 웹에서는 요청마다 새로 읽으면 매번 느려진다."""
    key = str(weights)
    if key not in _models:
        _models[key] = YOLO(key)
    return _models[key]


def analyze_image(img_bgr, seg_weights: Path = SEG_WEIGHTS, cls_weights: Path = CLS_WEIGHTS) -> dict:
    """이미 읽어들인 BGR 이미지 배열 한 장을 분석한다.

    파일 경로가 아니라 배열을 받는 이유: 웹에서 업로드된 사진은 개인정보라서
    디스크에 저장하지 않고 메모리에서만 처리해야 한다
    (web/backend/routers/analysis.py). 경로로 넣을 때와 배열로 넣을 때의 추론
    결과가 완전히 같은 것은 확인함 (박스/confidence/마스크 모두 일치).

    영역 검출에 실패하면 {"ok": False, "missing": [...]} 를 반환한다.
    """
    seg_result = _load_model(seg_weights).predict(
        source=img_bgr, imgsz=SEG_IMG_SIZE, save=False, verbose=False
    )[0]

    iris_box = find_best_iris_pupil_box(seg_result)
    sclera_mask = union_sclera_mask(seg_result, img_bgr.shape)
    sclera_pixels = int(sclera_mask.sum())

    cropped = None
    if iris_box is not None:
        x1, y1, x2, y2 = pad_and_clip_box(iris_box, img_bgr.shape, PADDING_RATIO)
        crop = img_bgr[y1:y2, x1:x2]
        cropped = crop if crop.size > 0 else None

    missing = []
    if cropped is None:
        missing.append("홍채+동공")
    if sclera_pixels == 0:
        missing.append("공막")
    if missing:
        return {"ok": False, "missing": missing}

    cls_result = _load_model(cls_weights).predict(
        source=cropped, imgsz=CLS_IMG_SIZE, save=False, verbose=False
    )[0]
    cataract_prob = cataract_probability(cls_result)

    red_pixels = int(red_pixel_mask(img_bgr, sclera_mask).sum())

    return {
        "ok": True,
        "cataract_prob": cataract_prob,
        "cataract_label": classify_risk(cataract_prob),
        "redness_ratio": red_pixels / sclera_pixels,
    }


def analyze(image_path: Path, seg_weights: Path = SEG_WEIGHTS, cls_weights: Path = CLS_WEIGHTS) -> dict:
    """사진 파일 한 장을 읽어서 analyze_image()에 넘긴다 (CLI용)."""
    img_bgr = cv2.imread(str(image_path))
    if img_bgr is None:
        raise FileNotFoundError(f"{image_path} 를 읽을 수 없습니다.")
    return analyze_image(img_bgr, seg_weights, cls_weights)


def main():
    parser = argparse.ArgumentParser(description="눈 사진 한 장 -> 백내장 위험도 + 충혈도 분석")
    parser.add_argument("--image", type=Path, required=True, help="분석할 눈 사진 경로")
    parser.add_argument("--seg-weights", type=Path, default=SEG_WEIGHTS)
    parser.add_argument("--cls-weights", type=Path, default=CLS_WEIGHTS)
    args = parser.parse_args()

    for weights in (args.seg_weights, args.cls_weights):
        if not weights.exists():
            raise FileNotFoundError(f"{weights} 가 없습니다.")
    if not args.image.exists():
        raise FileNotFoundError(f"{args.image} 를 찾을 수 없습니다.")

    result = analyze(args.image, args.seg_weights, args.cls_weights)

    if not result["ok"]:
        print(f"눈 영역을 인식하지 못했습니다 ({', '.join(result['missing'])} 영역 미검출).")
        print("눈이 크고 선명하게 나오도록 다시 촬영한 사진으로 시도해주세요.")
        return

    print(f"백내장 의심 확률 : {result['cataract_prob'] * 100:.1f}%, {result['cataract_label']}")
    print(f"충혈도 : {result['redness_ratio'] * 100:.1f}%")


if __name__ == "__main__":
    main()
