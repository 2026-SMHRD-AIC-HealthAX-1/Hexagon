"""
sclera(공막) 영역 안에서 붉은 픽셀 비율(충혈도)을 계산한다.

eye_seg.pt로 sclera 마스크를 검출한 다음, 그 마스크 안의 픽셀만 HSV
색공간에서 "붉은 색" 범위에 해당하는지 판정해서 비율을 구한다. sclera
마스크가 여러 조각으로 나뉘어 검출되는 경우 전부 union해서 하나의 마스크로
취급한다 (AI/AI_Flow.txt 2번 섹션 계획 1)~3) 구현).

정상/주의/심각 구간 매핑(같은 계획의 4번)은 아직 경계값이 정해지지 않아서
REDNESS_THRESHOLDS는 임시값이다 - 실제 서비스에 쓰기 전 소량의 참고 사례로
튜닝 필요 (AI/Redness_AI.txt 참고).

사용법 (ultralytics, opencv-python 설치 필요):
    python redness_ratio.py
    python redness_ratio.py --image 다른사진.jpg

결과:
  - 콘솔에 sclera 픽셀 수 / 붉은 픽셀 수 / 비율 / 임시 판정 출력
  - sclera 영역(파랑)과 그 안에서 붉은 색으로 판정된 픽셀(초록)을 원본
    이미지 위에 오버레이해서 redness_result.jpg 로 저장 (눈으로 직접
    판정이 맞는지 확인하는 용도)
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

EYE_SEG_ROOT = Path(__file__).resolve().parent
WEIGHTS_PATH = EYE_SEG_ROOT / "eye_seg.pt"
DEFAULT_IMAGE = EYE_SEG_ROOT / "test_image.jpg"
OUTPUT_PATH = EYE_SEG_ROOT / "redness_result.jpg"

IMG_SIZE = 640  # 다른 eye_seg 스크립트들과 동일하게 맞춤
SCLERA_CLASS_NAME = "sclera"

# HSV 기준 "붉은 색" 범위 (OpenCV 관례: H 0-179, S/V 0-255).
# 빨강은 H=0 부근에서 양쪽으로 갈라져 있어서 두 구간을 합쳐서 쓴다.
# S/V 하한은 그림자(너무 어두움)나 반사광/흰자 특유의 흰 빛(채도 낮음)을
# "붉은 색"으로 오판하지 않기 위한 것 - 임상 근접샷 특유의 강한 glare를
# 감안해 채도(S) 하한을 넉넉히 잡았다. 조명별로 튜닝이 더 필요할 수 있음.
HSV_RED_RANGES = [
    ((0, 60, 40), (10, 255, 255)),
    ((170, 60, 40), (180, 255, 255)),
]

# 정상/주의/심각 경계값 - 아직 미정(TBD). 실제 안과 기준이나 팀 합의로
# 나중에 튜닝해야 하는 자리표시자(placeholder) 값이다.
CAUTION_RATIO = 0.05  # 이 비율 이상이면 "주의"
SEVERE_RATIO = 0.15  # 이 비율 이상이면 "심각"


def union_sclera_mask(result, img_shape):
    """sclera로 검출된 모든 인스턴스 마스크를 원본 이미지 크기로 리사이즈해서 union."""
    h, w = img_shape[:2]
    union = np.zeros((h, w), dtype=bool)
    if result.masks is None:
        return union

    class_names = result.names
    for i, cls_idx in enumerate(result.boxes.cls.tolist()):
        if class_names[int(cls_idx)] != SCLERA_CLASS_NAME:
            continue
        mask = result.masks.data[i].cpu().numpy()
        mask_resized = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
        union |= mask_resized > 0.5
    return union


def red_pixel_mask(img_bgr, sclera_mask):
    """sclera_mask 영역 안에서 붉은 색 범위에 해당하는 픽셀만 True인 마스크."""
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    red = np.zeros(sclera_mask.shape, dtype=bool)
    for lower, upper in HSV_RED_RANGES:
        in_range = cv2.inRange(hsv, np.array(lower), np.array(upper)) > 0
        red |= in_range
    return red & sclera_mask


def classify_redness(ratio):
    if ratio >= SEVERE_RATIO:
        return "심각"
    if ratio >= CAUTION_RATIO:
        return "주의"
    return "정상"


def compute_redness(image_path: Path, weights_path: Path = WEIGHTS_PATH):
    img_bgr = cv2.imread(str(image_path))
    if img_bgr is None:
        raise FileNotFoundError(f"{image_path} 를 읽을 수 없습니다.")

    model = YOLO(str(weights_path))
    results = model.predict(source=str(image_path), imgsz=IMG_SIZE, save=False, verbose=False)
    result = results[0]

    sclera_mask = union_sclera_mask(result, img_bgr.shape)
    sclera_pixels = int(sclera_mask.sum())
    if sclera_pixels == 0:
        return {
            "sclera_pixels": 0,
            "red_pixels": 0,
            "ratio": None,
            "status": None,
            "sclera_mask": sclera_mask,
            "red_mask": np.zeros_like(sclera_mask),
        }

    red_mask = red_pixel_mask(img_bgr, sclera_mask)
    red_pixels = int(red_mask.sum())
    ratio = red_pixels / sclera_pixels

    return {
        "sclera_pixels": sclera_pixels,
        "red_pixels": red_pixels,
        "ratio": ratio,
        "status": classify_redness(ratio),
        "sclera_mask": sclera_mask,
        "red_mask": red_mask,
    }


def save_visualization(img_bgr, sclera_mask, red_mask, output_path: Path):
    """sclera 영역은 파란색, 그 안에서 붉은 색으로 판정된 픽셀은 초록색으로 오버레이."""
    overlay = img_bgr.copy()
    overlay[sclera_mask] = (255, 150, 0)  # 파랑 계열 (BGR)
    overlay[red_mask] = (0, 255, 0)  # 초록 (붉은 픽셀 판정 강조)
    blended = cv2.addWeighted(img_bgr, 0.5, overlay, 0.5, 0)
    cv2.imwrite(str(output_path), blended)


def main():
    parser = argparse.ArgumentParser(description="sclera 영역 내 붉은 픽셀 비율(충혈도) 계산")
    parser.add_argument("--image", type=Path, default=DEFAULT_IMAGE)
    parser.add_argument("--weights", type=Path, default=WEIGHTS_PATH)
    args = parser.parse_args()

    if not args.weights.exists():
        raise FileNotFoundError(f"{args.weights} 가 없습니다.")
    if not args.image.exists():
        raise FileNotFoundError(f"{args.image} 를 찾을 수 없습니다.")

    result = compute_redness(args.image, args.weights)

    print(f"이미지: {args.image}")
    if result["ratio"] is None:
        print("sclera 영역이 검출되지 않았습니다.")
        return

    print(f"  공막(sclera) 픽셀 수: {result['sclera_pixels']}")
    print(f"  붉은 픽셀 수: {result['red_pixels']}")
    print(f"  충혈도 비율: {result['ratio'] * 100:.2f}%")
    print(f"  판정(임시 경계값 기준, 튜닝 필요): {result['status']}")

    img_bgr = cv2.imread(str(args.image))
    save_visualization(img_bgr, result["sclera_mask"], result["red_mask"], OUTPUT_PATH)
    print(f"\n시각화 결과 저장: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
