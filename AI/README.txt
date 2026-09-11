AI 모델 학습 - 사용법
(작성일: 2026-09-11)

S-03(사진 기반 백내장 위험도/충혈도 분석)에 쓸 두 개의 YOLO26-cls 분류 모델을
학습하기 위한 기초 코드입니다. 실제 학습은 Google Colab에서 진행할 예정이고,
이미지 리사이즈/분할은 이 프로젝트의 eye/ 가상환경에서 로컬로 미리 해둘 수
있습니다 (Pillow만 필요, ultralytics 불필요).

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
  redness/                충혈도 모델용 (정상/주의/심각 3단계 분류)
    normal/
    caution/
    severe/
    dataset/              prepare_dataset.py가 자동 생성 (git에 안 올라감)
      train/{normal,caution,severe}/
      val/{normal,caution,severe}/
  scripts/
    prepare_dataset.py    리사이즈 + train/val 분할 (로컬 실행, Pillow만 필요)
    train_cataract.py     cataract 모델 학습 (Colab 실행, ultralytics 필요)
    train_redness.py      redness 모델 학습 (Colab 실행, ultralytics 필요)
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
4. 참고
===========================================

- MODEL_NAME 상수가 "yolo26n-cls.pt"(nano, 가장 가볍고 빠름)로 되어 있습니다.
  정확도를 더 올리고 싶으면 train_*.py 상단의 MODEL_NAME을
  "yolo26s-cls.pt"/"yolo26m-cls.pt" 등으로 바꾸면 됩니다. ultralytics 버전에
  따라 정확한 모델 태그명이 다를 수 있으니 처음 실행할 때 가중치가 정상
  다운로드되는지 확인할 것.
- EPOCHS/IMG_SIZE/BATCH도 전부 스크립트 상단 상수라서 필요하면 바로 수정
  가능합니다.
- 이 모델들을 실제로 S-03(analysis.html)에 연결하는 작업은 아직 범위 밖입니다
  - 지금은 학습 코드까지만이고, 학습된 모델을 서버에서 불러와 실제 분석
  결과를 반환하는 부분은 별도로 논의 후 진행해야 합니다.
