"""
학습된 sclera/iris_pupil 세그멘테이션 모델(eye_seg.pt)을 폴더 안 이미지
전체에 돌려서 결과를 일괄 확인한다. inference.py(사진 한 장용)의 여러 장 버전.

기본적으로 같은 폴더의 dataset/images/ 아래(train+val 전체, 하위 폴더까지
재귀적으로 탐색)를 대상으로 돈다 - 재학습 후 학습에 쓰인 데이터셋 전체를
한 번에 다시 훑어보고 싶을 때 쓰는 용도.

사용법 (ultralytics 설치 필요: pip install ultralytics):
    python batch_inference.py
    python batch_inference.py --weights other.pt --images-dir some/dir --output-dir out/dir
"""
import argparse
from pathlib import Path

import cv2
from ultralytics import YOLO

EYE_SEG_ROOT = Path(__file__).resolve().parent
DEFAULT_WEIGHTS = EYE_SEG_ROOT / "eye_seg.pt"
DEFAULT_IMAGES_DIR = EYE_SEG_ROOT / "dataset" / "images"
DEFAULT_OUTPUT_DIR = EYE_SEG_ROOT / "check_result"

IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
IMG_SIZE = 640  # train_eye_seg.py와 동일하게 맞춤


def collect_images(images_dir: Path):
    return sorted(
        (p for p in images_dir.rglob("*") if p.suffix.lower() in IMG_EXTENSIONS),
        key=lambda p: p.stem,
    )


def main():
    parser = argparse.ArgumentParser(description="폴더 안 이미지 전체에 세그멘테이션 모델 일괄 테스트")
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--images-dir", type=Path, default=DEFAULT_IMAGES_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    if not args.weights.exists():
        raise FileNotFoundError(f"{args.weights} 가 없습니다.")
    if not args.images_dir.is_dir():
        raise FileNotFoundError(f"{args.images_dir} 가 없습니다.")

    images = collect_images(args.images_dir)
    if not images:
        raise ValueError(f"{args.images_dir} 에 이미지가 없습니다.")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(args.weights))

    print(f"{len(images)}장 처리 시작 (weights={args.weights})\n")
    skipped = 0
    for img_path in images:
        results = model.predict(source=str(img_path), imgsz=IMG_SIZE, save=False, verbose=False)
        result = results[0]

        if result.masks is None:
            print(f"  [검출 없음] {img_path.name}")
            skipped += 1
            continue

        class_names = result.names
        summary = []
        for i, cls_idx in enumerate(result.boxes.cls.tolist()):
            cls_name = class_names[int(cls_idx)]
            conf = result.boxes.conf[i].item()
            mask = result.masks.data[i].cpu().numpy()
            ratio = mask.sum() / mask.size * 100
            summary.append(f"{cls_name} {conf:.2f}({ratio:.1f}%)")

        plotted = result.plot()
        out_path = args.output_dir / f"{img_path.stem}.jpg"
        cv2.imwrite(str(out_path), plotted)
        print(f"  {img_path.name} -> {out_path.name}  [{', '.join(summary)}]")

    print(f"\n완료: {len(images) - skipped}/{len(images)}장 저장됨 -> {args.output_dir}")


if __name__ == "__main__":
    main()
