"""
서버 리듬게임 로직(rhythm_game_session.py)으로 기준값(fixture.json)을 만든다.

web/frontend/js/rhythm/gameEngine.js 가 같은 입력(시간/시선/깜빡임/난수)에
같은 판정과 점수를 내는지 비교하기 위한 것이다. 보통은 run.sh 를 쓰면 된다.

원본 코드는 건드리지 않는다. 대신 실행 직전에 모듈 네임스페이스의 time/random/
compute_gaze/BlinkMonitor/db 를 결정론적 스텁으로 바꿔치기해서, 게임 로직만
순수하게 재현한다.
"""
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[1]

sys.path.insert(0, str(PROJECT_ROOT / "src"))
sys.path.insert(0, str(PROJECT_ROOT / "web" / "backend"))

import sessions.rhythm_game_session as rgs  # noqa: E402

rng = random.Random(20260914)

FRAME_COUNT = 880
# 37ms: 일부러 50ms 같은 '딱 떨어지는' 간격을 피한다.
#
# 프레임이 50ms 배수면 elapsed - target 이 정확히 CATCH_WINDOW_MS(400) 가 되는
# 순간이 생기는데, 파이썬은 time.time()(초) 을 ms 로 되돌리면서 +4e-12 정도의
# 오차가 붙어 `> 400` 을 만족하고 JS(ms 로만 계산)는 만족하지 않아, 만료 판정이
# 한 프레임 어긋난다. 로직 차이가 아니라 수치 오차가 경계를 밀어낸 것이라
# 실제 플레이(프레임 간격이 고르지 않음)에서는 생기지 않는 상황이다.
# 37 은 3000/400 어느 쪽과도 정수배로 맞아떨어지지 않아 경계에 걸리지 않는다.
FRAME_INTERVAL_MS = 37  # 약 32.5초 분량 (게임 30초 종료까지 포함)

# ── 입력 스크립트 생성 ────────────────────────────────────────
# 시선은 세 레인 기준값 근처를 오가고, 깜빡임은 불규칙한 주기로 발생시켜
# perfect / 늦은 캐치(miss) / 놓쳐서 만료(miss) 가 모두 나오게 한다.
LANE_X = {"left": 0.30, "center": 0.50, "right": 0.70}

frames = []
blink_hold = 0
for i in range(FRAME_COUNT):
    elapsed_ms = i * FRAME_INTERVAL_MS

    # 시선: 2초 주기로 레인을 옮겨다니되 약간의 흔들림을 준다
    target = ["left", "center", "right"][(i // 20) % 3]
    gaze_x = LANE_X[target] + rng.uniform(-0.03, 0.03)

    # 깜빡임: 무작위로 시작해 2프레임 유지 (상승 엣지가 한 번만 잡히도록)
    if blink_hold > 0:
        is_blinking = True
        blink_hold -= 1
    else:
        is_blinking = rng.random() < 0.18
        if is_blinking:
            blink_hold = 1

    frames.append({"elapsed_ms": elapsed_ms, "gaze_x": gaze_x, "is_blinking": is_blinking})

# 일시정지 구간 (프레임 인덱스 기준) - pause/resume 경과시간 보정까지 검증
PAUSE_AT = 300
RESUME_AT = 330
PAUSE_GAP_MS = 4993  # 정지해 있는 동안 실제로 흐른 시간 (역시 비정수배로)

# 난수 소비열: 양쪽이 정확히 같은 값을 쓰도록 미리 뽑아둔다
spawn_delays = [rng.randint(1600, 3000) for _ in range(60)]
lane_choices = [rng.choice(["left", "center", "right"]) for _ in range(60)]


# ── 스텁 주입 ────────────────────────────────────────────────
class FakeClock:
    """rhythm_game_session 이 쓰는 time.time() 대체. 초 단위 실수를 돌려준다."""

    def __init__(self):
        self.ms = 0.0

    def time(self):
        return self.ms / 1000.0


class FakeRandom:
    def __init__(self):
        self.delay_i = 0
        self.choice_i = 0

    def randint(self, a, b):
        v = spawn_delays[self.delay_i % len(spawn_delays)]
        self.delay_i += 1
        return v

    def choice(self, seq):
        v = lane_choices[self.choice_i % len(lane_choices)]
        self.choice_i += 1
        return v


class FakeBlinkMonitor:
    """update() 가 스크립트대로 is_blinking 을 돌려준다."""

    def __init__(self):
        self.value = False

    def update(self, landmarks):
        return {"is_blinking": self.value}


class FakeDb:
    @staticmethod
    def has_calibration(user_id):
        return True

    @staticmethod
    def get_calibration_samples(user_id):
        # create_region_points 가 (y, x) 정렬로 1~9 를 매겼을 때
        # lane_x 가 위 LANE_X 와 같아지도록 만든 샘플.
        samples = []
        xs = [LANE_X["left"], LANE_X["center"], LANE_X["right"]]
        for row, sy in enumerate([100, 540, 980]):
            for col, sx in enumerate([100, 960, 1820]):
                samples.append({"screen": [sx, sy], "gaze": [xs[col], 0.5]})
        return samples


clock = FakeClock()
fake_random = FakeRandom()

rgs.time = clock
rgs.random = fake_random
rgs.db = FakeDb
rgs.compute_gaze = lambda landmarks, smoother: (landmarks["gaze_x"], 0.5)
rgs.BlinkMonitor = FakeBlinkMonitor

# ── 실행 ────────────────────────────────────────────────────
session = rgs.RhythmGameSession(user_id=1)

states = []
for i, frame in enumerate(frames):
    if i == PAUSE_AT:
        clock.ms = frame["elapsed_ms"]
        session.pause()
    if i == RESUME_AT:
        # 정지해 있는 동안 실제 시간은 흘렀다
        clock.ms = frame["elapsed_ms"] + PAUSE_GAP_MS
        session.resume()

    clock.ms = frame["elapsed_ms"] + (PAUSE_GAP_MS if i >= RESUME_AT else 0)
    session.blink_monitor.value = frame["is_blinking"]

    state = session.process({"gaze_x": frame["gaze_x"]})
    states.append(state)

out = {
    "input": {
        "frames": frames,
        "lane_x": LANE_X,
        "spawn_delays": spawn_delays,
        "lane_choices": lane_choices,
        "pause_at": PAUSE_AT,
        "resume_at": RESUME_AT,
        "pause_gap_ms": PAUSE_GAP_MS,
    },
    "expected": {"states": states},
}

dest = HERE / "fixture.json"
dest.write_text(json.dumps(out), encoding="utf-8")

final = states[-1]
judged = sum(1 for s in states if s["last_judgment"])
print(f"기준값 생성: {dest.name}  (frames={len(frames)})")
print(f"  판정 이벤트 {judged}회, 최종 score={final['score']} "
      f"perfect={final['perfect_count']} miss={final['miss_count']}")
if judged == 0:
    print("  경고: 판정이 한 번도 발생하지 않아 검증 가치가 없습니다.")
