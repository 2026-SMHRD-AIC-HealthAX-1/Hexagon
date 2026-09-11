AI 모델 학습 - 사용법
(작성일: 2026-09-11)

S-03(사진 기반 백내장 위험도/충혈도 분석)에 쓸 모델들을 학습하기 위한 기초
코드입니다. 실제 학습은 Google Colab에서 진행할 예정이고, 이미지 준비(리사이즈/
분할/형식 변환)는 이 프로젝트의 eye/ 가상환경에서 로컬로 미리 해둘 수 있습니다
(Pillow만 필요, ultralytics 불필요).

- cataract: YOLO26-cls 분류 모델 (정상/백내장 2진 분류)
- redness: 아직 최종 방식 미정 - AI/Redness_AI.txt 참고. 유력한 방식은
  "공막 영역 검출 후 그 안의 붉은 픽셀 비율 계산"이고, 그 첫 단계로 쓸
  공막/홍채+동공 세그멘테이션 모델(YOLO26-seg) 기초 코드도 준비됨 (4번 섹션).

===========================================
0. 폴더 구조
===========================================

AI/
  cataract/              백내장 모델용 (정상/백내장 2진 분류)
    normal/              <- 원본 이미지를 여기에 정리해서 넣기
    cataract/             <- 원본 이미지를 여기에 정리해서 넣기
    dataset/              prepare_dataset.py가 자동 생성 (git에 안 올라감)
      train/{normal,cataract}/
      val/{normal,cataract}/
  redness/                충혈도 모델용 (정상/주의/심각 3단계 분류, 방식 검토 중)
    normal/
    caution/
    severe/
    dataset/              prepare_dataset.py가 자동 생성 (git에 안 올라감)
      train/{normal,caution,severe}/
      val/{normal,caution,severe}/
    sclera_seg/            공막/홍채+동공 세그멘테이션용 (redness 파이프라인 전처리)
      raw/                 <- labelme 라벨링 결과(이미지+json)를 여기에
      dataset/             prepare_segmentation.py가 자동 생성 (git에 안 올라감)
  scripts/
    prepare_dataset.py       리사이즈 + train/val 분할 (로컬 실행, Pillow만 필요)
    train_cataract.py        cataract 모델 학습 (Colab 실행, ultralytics 필요)
    train_redness.py         redness 분류 모델 학습 (Colab 실행, ultralytics 필요)
    prepare_segmentation.py  labelme 라벨 -> YOLO-seg 형식 변환 (로컬 실행, Pillow만 필요)
    train_eye_seg.py          공막/홍채+동공 세그멘테이션 모델 학습 (Colab, ultralytics 필요)
    inference.py              학습된 세그멘테이션 모델을 사진 한 장에 테스트 (Colab, ultralytics 필요)
  runs/                   학습 결과(가중치 등) 저장 위치 (git에 안 올라감)

AI/cataract/, AI/redness/, AI/runs/ 는 전부 .gitignore 처리되어 있습니다 -
이미지 데이터/학습 결과물은 용량이 크고 저작권 확인이 안 된 원본 데이터셋이
섞여있을 수 있어서 로컬 전용입니다. 커밋되는 건 scripts/와 이 README뿐입니다.

===========================================
1. 원본 이미지 정리
===========================================

cataract 모델:
  AI/cataract/normal/    에 정상 안구 사진
  AI/cataract/cataract/  에 백내장 안구 사진

redness 모델:
  AI/redness/normal/     에 정상 안구 사진
  AI/redness/caution/    에 충혈 "주의" 단계 사진
  AI/redness/severe/     에 충혈 "심각" 단계 사진

폴더 안 이미지는 하위 폴더 없이 평평하게(flat) 넣으면 됩니다 - jpg/jpeg/png/
bmp/webp 확장자를 인식합니다.

===========================================
2. 리사이즈 + train/val 분할 (로컬)
===========================================

프로젝트 루트에서, eye/ 가상환경 활성화 후:

    source eye/bin/activate
    python AI/scripts/prepare_dataset.py --task cataract --classes normal cataract
    python AI/scripts/prepare_dataset.py --task redness --classes normal caution severe

각 이미지를 비율 유지한 채 정사각형(기본 224x224, 남는 부분은 검은 여백)으로
리사이즈하고, 열리지 않는 손상된 이미지는 자동으로 건너뛰면서, 클래스별로
train 80% / val 20%(기본값)로 무작위 분할해 AI/<task>/dataset/ 에 저장합니다.
옵션(--img-size, --val-ratio, --seed)은 스크립트 상단 설명 참고.

===========================================
3. Colab에서 학습
===========================================

1) AI/cataract/dataset/ (또는 AI/redness/dataset/) 폴더를 Colab에 업로드하거나
   Google Drive에 올려서 mount - 리사이즈된 결과물만 올리면 되므로 원본보다
   훨씬 용량이 작고 업로드가 빠릅니다.
2) train_cataract.py / train_redness.py도 같이 업로드 (또는 코드 내용을 Colab
   셀에 그대로 붙여넣기).
3) 런타임 > 런타임 유형 변경 > GPU 선택 (필수는 아니지만 훨씬 빠름).
4) Colab 셀에서:

       !pip install ultralytics -q
       !python train_cataract.py     # 또는 train_redness.py

   Colab의 파일 경로가 스크립트 상단 DATASET_DIR/RUNS_DIR 상수와 다르면 그
   경로를 Colab 환경에 맞게 고쳐서 실행할 것 (예: Drive 마운트 경로).

학습 결과(가중치)는 AI/runs/cataract/weights/best.pt (또는
AI/runs/redness/weights/best.pt)에 저장됩니다.

===========================================
4. 공막/홍채+동공 세그멘테이션 모델 (redness 파이프라인 전처리용)
===========================================

색상 임계값만으로 홍채/동공과 공막을 구분하려 했으나, 백내장으로 동공이
뿌옇게 보이는 사진이나 반사광(glare) 때문에 불안정하다고 판단해 작은
세그멘테이션 모델을 따로 학습하기로 함 (배경은 AI/Redness_AI.txt 참고).

1) 라벨링 (로컬, labelme 설치 필요: pip install labelme):
   AI/redness/sclera_seg/raw/ 에 30장 내외(눈동자 색/반사광/백내장 유무 등
   다양하게 섞어서) 이미지를 넣고, labelme로 사진마다 폴리곤 2개를 그림:
     - 공막(흰자) 영역 -> label을 정확히 "sclera"로
     - 홍채+동공 영역 -> label을 정확히 "iris_pupil"로
   저장하면 img001.jpg 옆에 img001.json이 생성됨.

2) YOLO-seg 형식으로 변환 (로컬):
       source eye/bin/activate
       python AI/scripts/prepare_segmentation.py
   라벨명이 sclera/iris_pupil이 아니면 자동으로 건너뛰고 알려줍니다. 결과는
   AI/redness/sclera_seg/dataset/ (images/, labels/, data.yaml)에 저장됩니다.

3) Colab에서 학습 - 이 스크립트는 sclera_seg/dataset/과 같은 폴더(sclera_seg/)
   안에 train_eye_seg.py를 나란히 두는 걸 전제로 경로가 잡혀 있습니다
   (AI/cataract·AI/redness 분류 스크립트처럼 AI/ 전체를 업로드하는 방식이
   아님 - train_cataract.py/train_redness.py와 폴더 가정이 다르니 주의):
       %cd sclera_seg 폴더 경로
       !pip install ultralytics -q
       !python train_eye_seg.py
   (구조가 다르면 스크립트 상단 DATA_YAML/RUNS_DIR 상수를 직접 수정할 것)

결과물은 sclera_seg/runs/sclera_seg/weights/best.pt에 저장됩니다.

4) 학습 확인 (Colab, 같은 sclera_seg/ 폴더) - inference.py도 train_eye_seg.py
   와 같은 폴더에 두는 걸 전제로 경로가 잡혀 있습니다. 테스트할 사진을
   test_image.jpg라는 이름으로 그 폴더에 넣고:
       !python inference.py
   콘솔에 sclera/iris_pupil 각각의 confidence·픽셀 비율이 출력되고, 마스크를
   그린 결과가 inference_result.jpg로 저장됩니다 - 눈으로 직접 마스크 위치가
   맞는지 확인하는 용도. 다른 사진으로 보려면 `!python inference.py --image
   파일명.jpg`.

이 모델로 공막 영역을 뽑아낸 뒤 "공막 내 붉은 픽셀 비율 계산" 로직을 붙이는
건 아직 구현 전입니다 (AI/Redness_AI.txt의 할 일 목록 참고).

===========================================
5. 참고
===========================================

- MODEL_NAME 상수가 분류 모델은 "yolo26n-cls.pt", 세그멘테이션 모델은
  "yolo26n-seg.pt"(둘 다 nano, 가장 가볍고 빠름)로 되어 있습니다. 정확도를
  더 올리고 싶으면 train_*.py 상단의 MODEL_NAME을 "yolo26s-*.pt"/
  "yolo26m-*.pt" 등으로 바꾸면 됩니다. ultralytics 버전에 따라 정확한 모델
  태그명이 다를 수 있으니 처음 실행할 때 가중치가 정상 다운로드되는지
  확인할 것.
- EPOCHS/IMG_SIZE/BATCH도 전부 스크립트 상단 상수라서 필요하면 바로 수정
  가능합니다.
- 이 모델들을 실제로 S-03(analysis.html)에 연결하는 작업은 아직 범위 밖입니다
  - 지금은 학습 코드까지만이고, 학습된 모델을 서버에서 불러와 실제 분석
  결과를 반환하는 부분은 별도로 논의 후 진행해야 합니다.
