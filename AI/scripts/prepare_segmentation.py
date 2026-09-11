"""
labelme로 라벨링한 공막(sclera)/홍채·동공(iris_pupil) 폴리곤 마스크를
Ultralytics YOLO-seg가 요구하는 데이터셋 형식으로 변환한다.

라벨링 방법 (사전 준비):
    1) https://github.com/wkentaro/labelme 설치 (pip install labelme) 후 실행
    2) AI/redness/sclera_seg/raw/ 에 원본 눈 사진(약 30장, 눈 색/반사광/백내장
       유무 등 다양한 조건을 섞을 것)을 넣고, labelme로 각 사진마다 폴리곤을
       두 개 그린다:
         - 공막(흰자) 영역 -> label 이름을 정확히 "sclera"로
         - 홍채+동공 영역 -> label 이름을 정확히 "iris_pupil"로
       저장하면 같은 폴더에 img001.jpg 옆에 img001.json이 생긴다.

이 스크립트는 raw/ 안의 이미지+json 쌍을 읽어서 YOLO-seg 형식
(images/{train,val}/, labels/{train,val}/, data.yaml)으로 변환+분할한다.
Pillow만 있으면 되고(ultralytics 불필요), 이 프로젝트의 eye/ 가상환경에서
로컬로 실행하면 된다.

사용법:
    python AI/scripts/prepare_segmentation.py
"""
import argparse
import json
import random
import shutil
from pathlib import Path

# labelme에서 사용할 라벨 이름과 YOLO 클래스 id 매핑 - 라벨링할 때 정확히
# 이 이름(sclera, iris_pupil)을 써야 한다.
CLASSES = ["sclera", "iris_pupil"]


def collect_pairs(raw_dir: Path):
    pairs = []
    for json_path in sorted(raw_dir.glob("*.json")):
        img_path = None
        for ext in (".jpg", ".jpeg", ".png", ".bmp", ".webp"):
            candidate = json_path.with_suffix(ext)
            if candidate.exists():
                img_path = candidate
                break
        if img_path is None:
            print(f"[스킵] {json_path.name}과 짝이 되는 이미지 파일을 못 찾음")
            continue
        pairs.append((img_path, json_path))
    return pairs


def labelme_to_yolo_lines(json_path: Path):
    data = json.loads(json_path.read_text(encoding="utf-8"))
    width = data["imageWidth"]
    height = data["imageHeight"]

    lines = []
    for shape in data.get("shapes", []):
        label = shape.get("label")
        if label not in CLASSES:
            print(f"[스킵] {json_path.name}: 알 수 없는 라벨 '{label}' (sclera/iris_pupil만 인식)")
            continue
        points = shape.get("points", [])
        if len(points) < 3:
            print(f"[스킵] {json_path.name}: '{label}' 폴리곤 점이 3개 미만")
            continue

        class_id = CLASSES.index(label)
        norm_coords = []
        for x, y in points:
            norm_coords.append(f"{x / width:.6f}")
            norm_coords.append(f"{y / height:.6f}")
        lines.append(f"{class_id} " + " ".join(norm_coords))

    return lines


def prepare(val_ratio: float, seed: int):
    ai_root = Path(__file__).resolve().parent.parent
    base = ai_root / "redness" / "sclera_seg"
    raw_dir = base / "raw"
    dataset_dir = base / "dataset"

    pairs = collect_pairs(raw_dir)
    if not pairs:
        raise FileNotFoundError(
            f"{raw_dir} 에 이미지+json 쌍이 하나도 없습니다 - labelme로 라벨링부터 해주세요."
        )

    rng = random.Random(seed)
    rng.shuffle(pairs)
    n_val = max(1, round(len(pairs) * val_ratio))
    splits = {"val": pairs[:n_val], "train": pairs[n_val:]}

    for split_name, split_pairs in splits.items():
        img_out = dataset_dir / "images" / split_name
        label_out = dataset_dir / "labels" / split_name
        img_out.mkdir(parents=True, exist_ok=True)
        label_out.mkdir(parents=True, exist_ok=True)

        for img_path, json_path in split_pairs:
            lines = labelme_to_yolo_lines(json_path)
            if not lines:
                print(f"[스킵] {img_path.name}: 유효한 폴리곤이 없음")
                continue

            # 원본 형식 그대로 복사 (세그멘테이션은 분류와 달리 imgsz를
            # ultralytics가 학습 중에 알아서 처리하므로 리사이즈 불필요)
            shutil.copy2(img_path, img_out / img_path.name)
            (label_out / (img_path.stem + ".txt")).write_text("\n".join(lines) + "\n", encoding="utf-8")

    names_yaml = "\n".join(f"  {i}: {name}" for i, name in enumerate(CLASSES))
    data_yaml = f"""path: {dataset_dir}
train: images/train
val: images/val
names:
{names_yaml}
"""
    (dataset_dir / "data.yaml").write_text(data_yaml, encoding="utf-8")

    print(f"\n=== sclera 세그멘테이션 데이터셋 준비 완료: {dataset_dir} ===")
    for split_name, split_pairs in splits.items():
        print(f"  {split_name}: {len(split_pairs)}장")
    print(f"  data.yaml: {dataset_dir / 'data.yaml'}")


def main():
    parser = argparse.ArgumentParser(description="labelme 폴리곤 라벨을 YOLO-seg 형식으로 변환 + train/val 분할")
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    prepare(args.val_ratio, args.seed)


if __name__ == "__main__":
    main()
