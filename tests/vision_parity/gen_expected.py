"""
Python(src/) 원본 로직으로 기준값(fixture.json)을 생성한다.

web/frontend/js/vision/ 의 JS 포팅본이 같은 입력에 같은 숫자를 내는지 확인하기
위한 것으로, compare.mjs 가 이 파일이 만든 fixture.json 을 읽어 비교한다.
보통은 직접 실행하지 말고 run.sh 를 쓰면 된다.

    ./tests/vision_parity/run.sh
"""
import json
import random
import sys
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[1]

sys.path.insert(0, str(PROJECT_ROOT / "src"))

from gaze import compute_gaze, GazeSmoother  # noqa: E402
from blink_monitor import BlinkMonitor  # noqa: E402
from gaze_region_classifier import calculate_region_gaze, create_region_points  # noqa: E402

rng = random.Random(20260914)

N_FRAMES = 200
N_LANDMARKS = 478

# EAR 계산에 쓰이는 인덱스 (blink_monitor.py 의 update() 안 하드코딩 값과 동일)
LEFT_EYE_EAR = [33, 160, 158, 133, 153, 144]
RIGHT_EYE_EAR = [362, 385, 387, 263, 373, 380]


def write_eye(pts, eye_idx, cx, cy, width, ear):
    """
    EAR = (|p2-p6| + |p3-p5|) / (2*|p1-p4|) 가 정확히 주어진 ear 값이 되도록
    6개 점을 배치한다. 무작위 좌표로는 EAR 이 임계값(0.20) 아래로 내려가는 일이
    거의 없어서 깜빡임 상태 전이가 전혀 검증되지 않기 때문에 의도적으로 만들어준다.
    """
    h = ear * width / 2.0
    p1, p2, p3, p4, p5, p6 = eye_idx
    pts[p1] = [cx, cy]
    pts[p4] = [cx + width, cy]
    pts[p2] = [cx + width * 0.3, cy + h]
    pts[p6] = [cx + width * 0.3, cy - h]
    pts[p3] = [cx + width * 0.7, cy + h]
    pts[p5] = [cx + width * 0.7, cy - h]


# ── 입력 생성 ────────────────────────────────────────────────
frames = []
for i in range(N_FRAMES):
    pts = [[rng.random(), rng.random()] for _ in range(N_LANDMARKS)]

    # 12프레임 주기로 눈을 감았다 뜨게 해서 상승/하강 엣지를 모두 만든다.
    phase = i % 12
    ear_target = 0.08 if phase in (0, 1, 2) else 0.32

    # 한쪽 눈만 감긴 프레임(phase==2)을 섞어서 "양쪽 다 감겨야 감은 것"인
    # AND 조건까지 검증되게 한다.
    write_eye(pts, LEFT_EYE_EAR, 0.30, 0.45, 0.08, ear_target)
    write_eye(pts, RIGHT_EYE_EAR, 0.60, 0.45, 0.08,
              ear_target if phase != 2 else 0.32)

    frames.append(pts)

# 캘리브레이션 샘플: 9개 화면 포인트 x 각 12샘플.
# 입력 순서를 일부러 섞는다 - 그룹핑/정렬이 올바르면 입력 순서는 결과에 영향을
# 주지 않아야 하기 때문.
screen_points = [
    [100, 100], [960, 100], [1820, 100],
    [100, 540], [960, 540], [1820, 540],
    [100, 980], [960, 980], [1820, 980],
]
rng.shuffle(screen_points)

samples = []
for sp in screen_points:
    for _ in range(12):
        samples.append({"screen": sp, "gaze": [rng.random(), rng.random()]})
rng.shuffle(samples)

# ── Python 실행 ──────────────────────────────────────────────
smoother = GazeSmoother(alpha=0.2)
monitor = BlinkMonitor()

gaze_out = []
blink_out = []

for pts in frames:
    lms = [SimpleNamespace(x=p[0], y=p[1]) for p in pts]

    gx, gy = compute_gaze(lms, smoother)
    gaze_out.append([gx, gy])

    b = monitor.update(lms)
    # blink_durations/intervals 는 wall-clock 기반이라 언어 간 비교 대상이 아니다.
    blink_out.append([b["ear"], b["left_ear"], b["right_ear"],
                      bool(b["is_blinking"]), b["blink_count"]])

averages = calculate_region_gaze(samples)
region_points = create_region_points(averages)

# rhythm_game_session.py 가 실제로 쓰는 레인 x 좌표 유도까지 검증 대상에 포함.
# 영역 번호가 하나라도 밀리면 이 값이 달라지므로 정렬 버그를 잡아낸다.
lane_x = {
    "left": sum(region_points[r][0] for r in (1, 4, 7)) / 3,
    "center": sum(region_points[r][0] for r in (2, 5, 8)) / 3,
    "right": sum(region_points[r][0] for r in (3, 6, 9)) / 3,
}

out = {
    "input": {"frames": frames, "samples": samples},
    "expected": {
        "gaze": gaze_out,
        "blink": blink_out,
        "region_points": {str(k): list(v) for k, v in region_points.items()},
        "lane_x": lane_x,
    },
}

dest = HERE / "fixture.json"
dest.write_text(json.dumps(out), encoding="utf-8")

print(f"기준값 생성: {dest.name}  (frames={len(frames)}, samples={len(samples)})")
print(f"  깜빡임 전이 발생 횟수: {blink_out[-1][4]}회  <- 0이면 상태 전이가 검증 안 된 것")
