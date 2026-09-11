"""
학습된 공막(sclera)/홍채+동공(iris_pupil) 세그멘테이션 모델(eye_seg.pt)을
테스트 사진 한 장에 돌려서 결과를 확인한다.

이 폴더(models/eye_seg/) 안에 모델 관련 파일들이 함께 있다:
    models/eye_seg/
      eye_seg.pt          <- 학습된 가중치
      dataset/            <- 학습에 쓴 데이터셋 (images/labels/data.yaml)
      inference.py        <- 이 파일 (사진 한 장용)
      batch_inference.py  <- 폴더 전체 일괄 테스트용
      test_image.jpg      <- 테스트용 사진 (다른 파일명 쓰려면 --image로 지정)

사용법 (ultralytics 설치 필요: pip install ultralytics):
    python inference.py
    python inference.py --image 다른사진.jpg

결과:
  - 콘솔에 검출된 sclera/iris_pupil 각각의 confidence, 픽셀 수, 이미지 대비
    비율을 출력
  - 마스크가 그려진 결과 이미지를 inference_result.jpg 로 저장 (눈으로 직접
    마스크 위치가 맞는지 확인하는 용도)
"""
import argparse
from pathlib import Path

import cv2
from ultralytics import YOLO

EYE_SEG_ROOT = Path(__file__).resolve().parent
WEIGHTS_PATH = EYE_SEG_ROOT / "eye_seg.pt"
DEFAULT_IMAGE = EYE_SEG_ROOT / "test_image.jpg"
OUTPUT_PATH = EYE_SEG_ROOT / "inference_result.jpg"

IMG_SIZE = 640


def main():
    parser = argparse.ArgumentParser(description="sclera/iris_pupil 세그멘테이션 모델 테스트")
    parser.add_argument("--image", type=Path, default=DEFAULT_IMAGE)
    parser.add_argument("--weights", type=Path, default=WEIGHTS_PATH)
    args = parser.parse_args()

    if not args.weights.exists():
        raise FileNotFoundError(f"{args.weights} 가 없습니다.")
    if not args.image.exists():
        raise FileNotFoundError(f"{args.image} 를 찾을 수 없습니다.")

    model = YOLO(str(args.weights))
    results = model.predict(source=str(args.image), imgsz=IMG_SIZE, save=False)
    result = results[0]

    print(f"이미지: {args.image}")

    if result.masks is None:
        print("검출된 영역이 없습니다.")
        return

    class_names = result.names  # {0: 'sclera', 1: 'iris_pupil'}
    for i, cls_idx in enumerate(result.boxes.cls.tolist()):
        cls_name = class_names[int(cls_idx)]
        conf = result.boxes.conf[i].item()
        mask = result.masks.data[i].cpu().numpy()  # (mask_h, mask_w), 0 또는 1
        mask_pixels = int(mask.sum())
        ratio = mask_pixels / mask.size * 100
        print(f"  [{cls_name}] confidence={conf:.3f}  픽셀 수={mask_pixels}  마스크 대비={ratio:.1f}%")

    plotted = result.plot()  # 마스크/박스가 그려진 BGR 이미지(numpy array)
    cv2.imwrite(str(OUTPUT_PATH), plotted)
    print(f"\n마스크 시각화 결과 저장: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
