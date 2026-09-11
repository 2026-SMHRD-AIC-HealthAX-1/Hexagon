"""
공막(sclera) / 홍채+동공(iris_pupil) 영역을 검출하는 세그멘테이션 모델을
YOLO26-seg로 학습한다. 본격적인 충혈도(redness) 학습 전에, 눈 사진에서
공막 영역만 정확히 골라내기 위한 전처리 모델이다.

사전 준비:
    labelme로 raw/ 폴더에 30장 내외 라벨링 (AI/scripts/prepare_segmentation.py
    상단 설명 참고) 후:
        python AI/scripts/prepare_segmentation.py

Google Colab 사용법:
    1) AI/redness/sclera_seg/dataset/ (prepare_segmentation.py가 만든 결과물,
       images/labels/data.yaml 전부 포함)을 Colab에 업로드하거나 Drive에
       올려서 mount.
    2) 런타임 > 런타임 유형 변경 > GPU 선택 (필수는 아니지만 훨씬 빠름)
    3) 아래 두 줄을 셀에서 실행:
           !pip install ultralytics -q
           !python train_sclera_seg.py
       (DATA_YAML/RUNS_DIR 경로가 Colab 환경과 다르면 아래 상수를 맞게 수정할 것.
       data.yaml 안의 path도 Colab에서의 실제 경로와 일치해야 함.)

결과물(가중치 등)은 AI/runs/sclera_seg/weights/best.pt 에 저장된다. 학습된
모델은 나중에 redness 파이프라인에서 "사진 -> 공막 영역만 추출 -> 그 안에서
붉은 픽셀 비율 계산"의 첫 단계로 쓰인다.
"""
from pathlib import Path

from ultralytics import YOLO

AI_ROOT = Path(__file__).resolve().parent.parent
DATA_YAML = AI_ROOT / "redness" / "sclera_seg" / "dataset" / "data.yaml"
RUNS_DIR = AI_ROOT / "runs"

# nano 모델 - 데이터가 30장 내외로 적어서 큰 모델은 오히려 과적합 위험이 큼.
# 사전학습 가중치로 시작하므로(전이학습) 이 정도로도 시도해볼 만함.
MODEL_NAME = "yolo26n-seg.pt"

EPOCHS = 100
IMG_SIZE = 640
BATCH = 8  # 데이터가 적어서 작은 배치로 시작 - 필요하면 조정


def main():
    if not DATA_YAML.exists():
        raise FileNotFoundError(
            f"{DATA_YAML} 가 없습니다 - 먼저 prepare_segmentation.py를 실행해서 "
            f"라벨 데이터를 YOLO-seg 형식으로 변환해주세요."
        )

    model = YOLO(MODEL_NAME)
    model.train(
        data=str(DATA_YAML),
        epochs=EPOCHS,
        imgsz=IMG_SIZE,
        batch=BATCH,
        project=str(RUNS_DIR),
        name="sclera_seg",
    )


if __name__ == "__main__":
    main()
