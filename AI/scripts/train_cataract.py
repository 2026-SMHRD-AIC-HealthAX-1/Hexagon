"""
정상/백내장(normal/cataract) 2진 분류 모델을 YOLO26-cls로 학습한다.

사전 준비:
    python AI/scripts/prepare_dataset.py --task cataract --classes normal cataract

Google Colab 사용법:
    1) AI/cataract/dataset/ (prepare_dataset.py가 만든 결과물)을 Colab에 업로드하거나
       Google Drive에 올려서 mount - 원본이 아니라 리사이즈된 이 폴더만 올리면 됨.
    2) 런타임 > 런타임 유형 변경 > GPU 선택 (필수는 아니지만 훨씬 빠름)
    3) 아래 두 줄을 셀에서 실행:
           !pip install ultralytics -q
           !python train_cataract.py
       (DATASET_DIR 경로가 Colab 환경과 다르면 아래 상수를 맞게 수정할 것)

결과물(가중치 등)은 AI/runs/cataract/weights/best.pt 에 저장된다.
"""
from pathlib import Path

from ultralytics import YOLO

AI_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = AI_ROOT / "cataract" / "dataset"
RUNS_DIR = AI_ROOT / "runs"

# 모델 크기: n(nano)이 제일 가볍고 빠름 - 기초 실험/Colab 무료 GPU에 적합.
# 정확도를 더 올리고 싶으면 "yolo26s-cls.pt", "yolo26m-cls.pt" 등으로 바꾸면 됨.
# (설치된 ultralytics 버전에 따라 정확한 모델 태그명이 다를 수 있으니, 실행 전
#  `from ultralytics import YOLO; YOLO("yolo26n-cls.pt")` 가 정상적으로 가중치를
#  다운로드하는지 먼저 확인할 것.)
MODEL_NAME = "yolo26n-cls.pt"

EPOCHS = 50
IMG_SIZE = 224
BATCH = 32


def main():
    if not DATASET_DIR.exists():
        raise FileNotFoundError(
            f"{DATASET_DIR} 가 없습니다 - 먼저 prepare_dataset.py를 실행해서 "
            f"train/val 데이터셋을 만들어주세요."
        )

    model = YOLO(MODEL_NAME)
    model.train(
        data=str(DATASET_DIR),
        epochs=EPOCHS,
        imgsz=IMG_SIZE,
        batch=BATCH,
        project=str(RUNS_DIR),
        name="cataract",
    )


if __name__ == "__main__":
    main()
