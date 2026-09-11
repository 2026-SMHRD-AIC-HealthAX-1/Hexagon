"""
eye_seg 모델로 원본 눈 사진에서 홍채+동공(iris_pupil) 영역만 검출해서
그 부분만 크롭해 저장한다. cataract(백내장) 분류 모델을 "크롭된 홍채+동공
영역"으로 학습시키기 위한 전처리 단계 (AI/AI_Flow.txt 3번 섹션 계획의
1번). 크롭만 하고 리사이즈는 하지 않는다 - 리사이즈 + train/val 분할은
기존 prepare_dataset.py가 이어서 처리한다:
    1) python AI/scripts/crop_iris_pupil.py --classes normal cataract
    2) python AI/scripts/prepare_dataset.py --task cataract_cropped --classes normal cataract
       (--input-root/--output-root로 실제 위치를 맞춰서 실행)

**중요**: 실제 서비스에 붙일 때도 반드시 "eye_seg로 크롭 -> cataract 분류"
순서를 그대로 유지해야 한다 - 학습은 크롭된 사진으로 했는데 추론은 원본
전체 사진을 넣으면 모델이 학습 때 한 번도 못 본 형태의 입력을 받는 셈이라
정확도가 떨어진다 (AI_Flow.txt 3번 섹션 참고).

입력/출력 경로(--input-root/--output-root)는 지금 정리 중인 임시 경로다 -
실제 정제된 데이터셋 위치가 정해지면 그때 맞춰서 바꾸면 된다.

사용법 (ultralytics, opencv-python 설치 필요):
    python AI/scripts/crop_iris_pupil.py --classes normal cataract
    python AI/scripts/crop_iris_pupil.py --input-root AI/cataract \
        --output-root AI/cataract_cropped --classes normal cataract
"""
import argparse
from pathlib import Path

import cv2
from ultralytics import YOLO

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_WEIGHTS = PROJECT_ROOT / "models" / "eye_seg" / "eye_seg.pt"
DEFAULT_INPUT_ROOT = PROJECT_ROOT / "AI" / "cataract"  # 임시 경로 - 나중에 바뀔 수 있음
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "AI" / "cataract_cropped"  # 임시 경로 - 나중에 바뀔 수 있음

IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
IMG_SIZE = 640  # eye_seg 학습 때와 동일하게 맞춤
IRIS_PUPIL_CLASS_NAME = "iris_pupil"
PADDING_RATIO = 0.15  # 동공 경계에 딱 맞춰 자르면 너무 타이트해서 여유를 두는 비율


def collect_images(class_dir: Path):
    return sorted(p for p in class_dir.iterdir() if p.suffix.lower() in IMG_EXTENSIONS)


def find_best_iris_pupil_box(result):
    """iris_pupil로 검출된 인스턴스 중 confidence가 가장 높은 것의 [x1,y1,x2,y2]를
    원본 이미지 픽셀 좌표로 반환한다. 검출이 없으면 None."""
    if result.boxes is None or len(result.boxes) == 0:
        return None

    class_names = result.names
    best_conf = -1.0
    best_box = None
    for i, cls_idx in enumerate(result.boxes.cls.tolist()):
        if class_names[int(cls_idx)] != IRIS_PUPIL_CLASS_NAME:
            continue
        conf = result.boxes.conf[i].item()
        if conf > best_conf:
            best_conf = conf
            best_box = result.boxes.xyxy[i].tolist()
    return best_box


def pad_and_clip_box(box, img_shape, padding_ratio):
    x1, y1, x2, y2 = box
    h, w = img_shape[:2]
    box_w, box_h = x2 - x1, y2 - y1
    pad_x, pad_y = box_w * padding_ratio, box_h * padding_ratio
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(w, x2 + pad_x)
    y2 = min(h, y2 + pad_y)
    return int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))


def crop_class(model, src_dir: Path, out_dir: Path):
    images = collect_images(src_dir)
    if not images:
        raise ValueError(f"{src_dir}에 이미지가 하나도 없습니다.")

    out_dir.mkdir(parents=True, exist_ok=True)
    saved, skipped = 0, 0
    for img_path in images:
        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            print(f"  [스킵] 열 수 없는 이미지: {img_path.name}")
            skipped += 1
            continue

        results = model.predict(source=str(img_path), imgsz=IMG_SIZE, save=False, verbose=False)
        box = find_best_iris_pupil_box(results[0])
        if box is None:
            print(f"  [스킵] iris_pupil 검출 안 됨: {img_path.name}")
            skipped += 1
            continue

        x1, y1, x2, y2 = pad_and_clip_box(box, img_bgr.shape, PADDING_RATIO)
        cropped = img_bgr[y1:y2, x1:x2]
        if cropped.size == 0:
            print(f"  [스킵] 크롭 결과가 비어있음: {img_path.name}")
            skipped += 1
            continue

        out_path = out_dir / (img_path.stem + ".jpg")
        cv2.imwrite(str(out_path), cropped)
        saved += 1

    return saved, skipped


def main():
    parser = argparse.ArgumentParser(description="eye_seg로 홍채+동공(iris_pupil) 영역만 크롭해서 저장")
    parser.add_argument("--classes", nargs="+", required=True, help="예: normal cataract")
    parser.add_argument(
        "--input-root", type=Path, default=DEFAULT_INPUT_ROOT,
        help="<root>/<class>/*.jpg 구조의 원본 이미지 루트 (임시 경로 - 나중에 바뀔 수 있음)",
    )
    parser.add_argument(
        "--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT,
        help="크롭된 이미지를 저장할 루트, 클래스별 하위 폴더는 자동 생성 (임시 경로)",
    )
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    args = parser.parse_args()

    if not args.weights.exists():
        raise FileNotFoundError(f"{args.weights} 가 없습니다.")

    model = YOLO(str(args.weights))

    print(f"입력: {args.input_root}\n출력: {args.output_root}\n")
    total_saved, total_skipped = 0, 0
    for cls in args.classes:
        src_dir = args.input_root / cls
        if not src_dir.is_dir():
            raise FileNotFoundError(f"{src_dir} 폴더가 없습니다.")
        out_dir = args.output_root / cls
        print(f"[{cls}] 처리 중...")
        saved, skipped = crop_class(model, src_dir, out_dir)
        print(f"  -> {saved}장 저장, {skipped}장 스킵 (저장 위치: {out_dir})\n")
        total_saved += saved
        total_skipped += skipped

    print(f"완료: 총 {total_saved}장 저장, {total_skipped}장 스킵")


if __name__ == "__main__":
    main()
