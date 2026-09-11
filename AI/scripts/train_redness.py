"""
정상/주의/심각(normal/caution/severe) 3단계 안구 충혈도 분류 모델을 YOLO26-cls로 학습한다.

사전 준비:
    python AI/scripts/prepare_dataset.py --task redness --classes normal caution severe

Google Colab 사용법:
    1) AI/redness/dataset/ (prepare_dataset.py가 만든 결과물)을 Colab에 업로드하거나
       Google Drive에 올려서 mount - 원본이 아니라 리사이즈된 이 폴더만 올리면 됨.
    2) 런타임 > 런타임 유형 변경 > GPU 선택 (필수는 아니지만 훨씬 빠름)
    3) 아래 두 줄을 셀에서 실행:
           !pip install ultralytics -q
           !python train_redness.py
       (DATASET_DIR 경로가 Colab 환경과 다르면 아래 상수를 맞게 수정할 것)

결과물(가중치 등)은 AI/runs/redness/weights/best.pt 에 저장된다.
"""
from pathlib import Path

from ultralytics import YOLO

AI_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = AI_ROOT / "redness" / "dataset"
RUNS_DIR = AI_ROOT / "runs"

# train_cataract.py와 동일한 이유로 nano 모델 기본값 - 필요하면 s/m/l/x로 교체.
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
        name="redness",
    )


if __name__ == "__main__":
    main()
