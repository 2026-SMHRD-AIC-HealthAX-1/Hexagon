"""백내장 분류 모델(best.pt) 추론 스크립트.

**입력은 eye_seg로 크롭한 홍채+동공 이미지여야 한다** - 학습을 크롭된
사진으로 했기 때문에 원본 사진 전체를 넣으면 정확도가 떨어진다
(AI/AI_Flow.txt 3번 섹션). 원본 사진 한 장을 그대로 분석하려면 크롭까지
같이 처리해주는 models/eye_analysis.py를 쓸 것.

사용법:
    python models/cataract_cls/infer.py <크롭된_이미지경로>
"""

import argparse
from pathlib import Path

from ultralytics import YOLO

MODEL_PATH = Path(__file__).parent / "best.pt"
IMG_SIZE = 224  # 학습 시 imgsz와 동일하게 맞춤

# 백내장 확률 기준 3단계 판정 구간 (질병 관련 수치라 보수적으로 설정 -
# 30% 미만만 정상으로 보고, 애매한 구간은 전부 주의 필요로 분류)
LOW_THRESHOLD = 0.3   # 미만: 정상
HIGH_THRESHOLD = 0.7  # 이상: 위험


def classify_risk(
    cataract_prob: float, low: float = LOW_THRESHOLD, high: float = HIGH_THRESHOLD
) -> str:
    if cataract_prob < low:
        return "정상"
    if cataract_prob < high:
        return "주의 필요"
    return "위험"


def cataract_probability(result) -> float:
    """YOLO-cls 추론 결과에서 cataract 클래스의 확률만 꺼낸다."""
    names = result.names  # {0: 'cataract', 1: 'normal'}
    probs = result.probs.data.tolist()
    cataract_idx = next(i for i, n in names.items() if n == "cataract")
    return probs[cataract_idx]


def predict(image_path: str, low: float = LOW_THRESHOLD, high: float = HIGH_THRESHOLD) -> dict:
    model = YOLO(str(MODEL_PATH))
    result = model.predict(image_path, imgsz=IMG_SIZE, verbose=False)[0]
    cataract_prob = cataract_probability(result)

    return {
        "label": classify_risk(cataract_prob, low, high),
        "cataract_prob": cataract_prob,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="백내장 분류 모델 추론")
    parser.add_argument("image", help="분석할 눈 이미지 경로")
    parser.add_argument("--low", type=float, default=LOW_THRESHOLD, help="정상 판정 상한선 (기본 0.3)")
    parser.add_argument("--high", type=float, default=HIGH_THRESHOLD, help="위험 판정 하한선 (기본 0.7)")
    args = parser.parse_args()

    result = predict(args.image, args.low, args.high)

    print(f"판정: {result['label']}")
    print(f"백내장 확률: {result['cataract_prob'] * 100:.1f}%")


if __name__ == "__main__":
    main()
