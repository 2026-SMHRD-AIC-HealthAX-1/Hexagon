"""
원본 클래스별 이미지 폴더(AI/<task>/<class>/*.jpg)를 읽어서
  - 손상되어 열리지 않는 이미지는 건너뛰고
  - 비율을 유지한 채 정사각형으로 리사이즈(letterbox, 남는 부분은 검은색 여백)하고
  - train/val로 무작위 분할해서
AI/<task>/dataset/{train,val}/<class>/ 에 저장한다.

Pillow만 있으면 실행되므로 (ultralytics 불필요) 이 프로젝트의 eye/ 가상환경에서
로컬로 미리 돌려두고, 리사이즈된 결과물(AI/<task>/dataset/)만 Colab에 올리면 된다 -
원본 원본 이미지보다 용량이 훨씬 작아서 업로드가 빠르다.

사용법:
    python AI/scripts/prepare_dataset.py --task cataract --classes normal cataract
    python AI/scripts/prepare_dataset.py --task redness --classes normal caution severe

먼저 AI/<task>/<class명>/ 폴더 각각에 정리한 원본 이미지를 넣어둔 상태여야 한다.
"""
import argparse
import random
from pathlib import Path

from PIL import Image, ImageOps

IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def letterbox_resize(img: Image.Image, size: int) -> Image.Image:
    """비율을 유지한 채 size x size 정사각형으로 맞추고, 남는 부분은 검은색으로 채운다."""
    img = ImageOps.exif_transpose(img)  # 스마트폰 사진의 회전 정보(EXIF)를 실제 픽셀에 반영
    img = img.convert("RGB")

    ratio = min(size / img.width, size / img.height)
    new_w, new_h = max(1, round(img.width * ratio)), max(1, round(img.height * ratio))
    resized = img.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    canvas.paste(resized, ((size - new_w) // 2, (size - new_h) // 2))
    return canvas


def collect_images(class_dir: Path):
    return sorted(p for p in class_dir.iterdir() if p.suffix.lower() in IMG_EXTENSIONS)


def prepare(task: str, classes: list, img_size: int, val_ratio: float, seed: int):
    ai_root = Path(__file__).resolve().parent.parent
    base = ai_root / task
    dataset_dir = base / "dataset"

    rng = random.Random(seed)
    summary = {}

    for cls in classes:
        src_dir = base / cls
        if not src_dir.is_dir():
            raise FileNotFoundError(
                f"{src_dir} 폴더가 없습니다 - AI/{task}/{cls}/ 에 이미지를 먼저 넣어주세요."
            )

        images = collect_images(src_dir)
        if not images:
            raise ValueError(f"{src_dir}에 이미지가 하나도 없습니다.")

        rng.shuffle(images)
        n_val = max(1, round(len(images) * val_ratio))
        val_images = images[:n_val]
        train_images = images[n_val:]

        counts = {}
        for split_name, split_images in [("train", train_images), ("val", val_images)]:
            out_dir = dataset_dir / split_name / cls
            out_dir.mkdir(parents=True, exist_ok=True)

            saved = 0
            for src_path in split_images:
                try:
                    with Image.open(src_path) as img:
                        canvas = letterbox_resize(img, img_size)
                except Exception as e:
                    print(f"[스킵] 손상되었거나 열 수 없는 이미지: {src_path} ({e})")
                    continue
                out_path = out_dir / (src_path.stem + ".jpg")
                canvas.save(out_path, "JPEG", quality=95)
                saved += 1
            counts[split_name] = saved

        summary[cls] = counts

    print(f"\n=== '{task}' 데이터셋 준비 완료: {dataset_dir} ===")
    for cls, counts in summary.items():
        print(f"  {cls}: train {counts['train']}장, val {counts['val']}장")


def main():
    parser = argparse.ArgumentParser(description="클래스별 원본 이미지를 리사이즈 + train/val 분할")
    parser.add_argument("--task", required=True, choices=["cataract", "redness"])
    parser.add_argument("--classes", nargs="+", required=True, help="예: normal cataract")
    parser.add_argument("--img-size", type=int, default=224)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    prepare(args.task, args.classes, args.img_size, args.val_ratio, args.seed)


if __name__ == "__main__":
    main()
