"""
서버 시선추적 미니게임 로직(calibration_session.py + game_session.py)으로
기준값(fixture.json)을 만든다.

web/frontend/js/gaze/calibrationEngine.js, js/gaze/gameEngine.js 가 같은
입력(시간/시선/난수)에 같은 결과를 내는지 비교하기 위한 것이다.
보통은 run.sh 를 쓰면 된다.

원본 코드는 건드리지 않는다. 대신 실행 직전에 각 모듈 네임스페이스의
time/random/compute_gaze/db 를 결정론적 스텁으로 바꿔치기해서, 판정 로직만
순수하게 재현한다. rhythm_parity 와의 차이: 이쪽 엔진들은 전부 "초" 단위로
동작하므로(파이썬 time.time() 과 동일 단위) ms<->초 변환에서 생기던 부동소수점
오차 문제 자체가 없다 - 파이썬과 JS에 완전히 같은 리터럴 초 값을 그대로
주입하기 때문.

주의: calibration_session.py 와 calibration.py 는 각자 자기 모듈 네임스페이스로
`import time` 를 했으므로, 시각을 통제하려면 두 모듈 모두 따로 패치해야 한다.
game_session.py 와 gaze_game.py 도 마찬가지(time, 그리고 gaze_game 은 random 도).
"""
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[1]

sys.path.insert(0, str(PROJECT_ROOT / "src"))
sys.path.insert(0, str(PROJECT_ROOT / "web" / "backend"))

import calibration as calib_mod  # noqa: E402
import gaze_game as gg_mod  # noqa: E402
import sessions.calibration_session as cs  # noqa: E402
import sessions.game_session as gs  # noqa: E402


class FakeClock:
    """time 모듈 대체. 초 단위 실수를 그대로 돌려준다 (ms 변환 없음)."""

    def __init__(self):
        self.t = 0.0

    def time(self):
        return self.t


class FakeRandomQueue:
    """random 모듈 대체. randint(a, b) 를 미리 뽑아둔 큐에서 순서대로 꺼낸다."""

    def __init__(self, queue):
        self.queue = queue
        self.i = 0

    def randint(self, a, b):
        v = self.queue[self.i % len(self.queue)]
        self.i += 1
        return v


# ═══════════════════════════════════════════════════════════════
# 1. 캘리브레이션 (calibration.py + calibration_session.py)
# ═══════════════════════════════════════════════════════════════
#
# 화면 전체를 고정 타임라인으로 훑는다 - 게임과 달리 캘리브레이션은 자기 상태를
# 보고 다음 입력을 정하는 분기가 없으므로(고정된 9포인트 순서), 프레임을
# 미리 통째로 계획해도 된다.
#
# 포인트 하나당 아래 오프셋(포인트 시작 시각 기준 경과초)으로 프레임을 찍어
# 샘플 수집 구간(0.3~2.8s, 2.8 미포함)과 다음 포인트 전환(3.0s) 경계를 모두
# 지나가 본다. 경계값 자체(0.3/2.8/3.0)는 일부러 안 쓴다 - point_base(예: 24.008)
# + 경계값(예: 2.8) 을 더했다가 다시 빼는 부동소수점 연산이 어느 쪽으로
# 반올림되는지는 point_base 값마다 달라서, 정확히 경계 위에 놓으면 로직과
# 무관하게 포인트별로 샘플 개수가 흔들린다(실제로 9번째 포인트에서 한 번
# 겪음). 그 대신 경계 바로 앞/뒤 값으로 "포함/제외"를 각각 확인한다.
PHASE_OFFSETS = [0.0, 0.1, 0.299, 0.301, 0.4, 1.0, 1.5, 2.0, 2.5, 2.799, 2.801, 2.9, 2.999, 3.001]

CAL_WIDTH, CAL_HEIGHT = 1600, 900

class FakeCalibrationDb:
    """CalibrationSession.process() 가 완료 시 호출하는 db.save_calibration() 스텁."""

    saved = []

    @staticmethod
    def save_calibration(user_id, width, height, samples):
        FakeCalibrationDb.saved.append((user_id, width, height, samples))


cal_clock = FakeClock()
calib_mod.time = cal_clock
cs.time = cal_clock
cs.db = FakeCalibrationDb
cs.compute_gaze = lambda landmarks, smoother: (landmarks["gaze_x"], landmarks["gaze_y"])

cal_session = cs.CalibrationSession(CAL_WIDTH, CAL_HEIGHT, user_id=1)

cal_frames = []
cal_states = []

for point_index in range(9):
    # 각 포인트의 실제 start_time 은 "이전 포인트의 마지막 오프셋(전환을 일으킨
    # 값)" 만큼씩 누적된다 - 3.0 이 아니라 PHASE_OFFSETS[-1](3.001) 이어야
    # 실제 내부 상태와 우리가 찍는 시각이 어긋나지 않는다.
    point_base = point_index * PHASE_OFFSETS[-1]
    for offset in PHASE_OFFSETS:
        t = point_base + offset
        cal_clock.t = t

        # 포인트마다, 그리고 프레임마다 조금씩 다른 시선값을 줘서(자잘한 흔들림
        # 포함) 표본이 실제로 제대로 모이는지(개수/화면좌표 태그) 검증한다.
        gaze_x = 0.1 * point_index + 0.001 * len(cal_frames)
        gaze_y = 0.05 * point_index + 0.3

        landmarks = {"gaze_x": gaze_x, "gaze_y": gaze_y}
        cal_frames.append({"t": t, "gaze_x": gaze_x, "gaze_y": gaze_y})

        state = cal_session.process(landmarks)
        cal_states.append(state)

final_cal_samples = cal_session.calibration.samples

print(f"[캘리브레이션] 프레임 {len(cal_frames)}개, 최종 finished={cal_states[-1]['finished']}, "
      f"수집된 샘플 {len(final_cal_samples)}개")
assert cal_states[-1]["finished"] is True, "캘리브레이션이 끝나지 않았습니다 (테스트 설계 오류)"
assert not any(s["finished"] for s in cal_states[:-1]), "캘리브레이션이 예정보다 일찍 끝났습니다"


# ═══════════════════════════════════════════════════════════════
# 2. 게임 (gaze_game.py + game_session.py)
# ═══════════════════════════════════════════════════════════════
#
# 게임은 "현재 목표"를 봐야 성공하는 구조라 자기 상태(session.game.current_target)
# 를 보고 다음 입력을 정하는 적응형 스크립트로 만든다. 파이썬이 기준(ground
# truth) 이므로, 여기서 만든 프레임(경과시간/시선좌표) 을 그대로 fixture 에
# 저장해두면 JS 쪽은 같은 프레임을 그대로 재생하기만 하면 된다 - JS의 목표
# 선택이 파이썬과 다르게 갈라지면 "엉뚱한 위치를 보고 있는" 것으로 드러나
# score/target 비교에서 바로 잡힌다.
GAME_WIDTH, GAME_HEIGHT = 1200, 800
SEED = 20260914

rng = random.Random(SEED)
randint_queue = [rng.randint(1, 9) for _ in range(300)]


def gaze_for_target(n):
    """region_points[n] 의 정확한 중심 좌표 (predict() 가 무조건 그 영역을 고르게)."""
    col = (n - 1) % 3
    row = (n - 1) // 3
    return float(col), float(row)


# gaze_region_classifier.calculate_region_gaze/create_region_points 가 만들어낼
# 결과를 직접 하드코딩한다 (그 변환 자체는 tests/vision_parity 에서 이미 검증됨).
REGION_POINTS = {n: list(gaze_for_target(n)) for n in range(1, 10)}


class FakeDb:
    @staticmethod
    def has_calibration(user_id):
        return True

    @staticmethod
    def get_calibration_samples(user_id):
        # region_points 가 REGION_POINTS 와 정확히 같아지도록 만든 표본.
        samples = []
        for n in range(1, 10):
            col = (n - 1) % 3
            row = (n - 1) // 3
            sx = [100, 600, 1100][col]
            sy = [100, 400, 700][row]
            gx, gy = gaze_for_target(n)
            samples.append({"screen": [sx, sy], "gaze": [gx, gy]})
        return samples


game_clock = FakeClock()
game_random = FakeRandomQueue(randint_queue)

gg_mod.time = game_clock
gg_mod.random = game_random
gs.time = game_clock
gs.db = FakeDb
gs.compute_gaze = lambda landmarks, smoother: (landmarks["gaze_x"], landmarks["gaze_y"])

game_session = gs.GameSession(GAME_WIDTH, GAME_HEIGHT, user_id=1)

game_frames = []
game_states = []
t = 0.0


def step(gaze_x, gaze_y, dt):
    global t
    t += dt
    game_clock.t = t
    landmarks = {"gaze_x": gaze_x, "gaze_y": gaze_y}
    game_frames.append({"t": t, "gaze_x": gaze_x, "gaze_y": gaze_y})
    state = game_session.process(landmarks)
    game_states.append(state)
    return state


# Phase A: 8번의 "정확히 맞추기" 사이클. 매번 다른 곳을 잠깐 봤다가(reset 검증)
# 목표로 돌아와 0.5초 이상 유지해 성공시킨다. next_target() 의 "이전과 달라야
# 함" 재추첨 루프가 파이썬/JS 양쪽에서 같은 횟수만큼 큐를 소비하는지도 이걸로
# 같이 검증된다(소비 순서가 어긋나면 이후 목표 시퀀스 전체가 갈라져 바로 드러남).
for _ in range(8):
    target = game_session.game.current_target
    gx, gy = gaze_for_target(target)

    step(gx, gy, dt=0.05)  # 목표 진입, 아직 부족

    other = (target % 9) + 1
    ox, oy = gaze_for_target(other)
    step(ox, oy, dt=0.1)  # 잠깐 다른 곳을 봄 -> 유지시간 리셋

    step(gx, gy, dt=0.05)  # 목표로 복귀, 유지시간 다시 시작
    step(gx, gy, dt=0.5)  # 0.5초 유지 -> 성공
    step(gx, gy, dt=0.01)  # 성공 직후 한 프레임

# Phase B: 제한시간(30초) 종료 경계를 지나가 본다. 어떤 목표에도 정확히
# 걸치지 않는 애매한 지점을 봐서 이 구간에서는 추가 캐치가 일어나지 않게 한다.
off_x, off_y = 0.5, 0.5
remaining_to_29_5 = 29.5 - t
assert remaining_to_29_5 > 0, "Phase A 가 이미 29.5초를 넘겨버렸습니다 (테스트 설계 오류)"
step(off_x, off_y, dt=remaining_to_29_5)  # t=29.5, finished 아직 False
step(off_x, off_y, dt=0.4)  # t=29.9
step(off_x, off_y, dt=0.05)  # t=29.95
step(off_x, off_y, dt=0.05)  # t=30.0 -> finished True

final_game = game_states[-1]
print(f"[게임] 프레임 {len(game_frames)}개, 최종 score={final_game['score']}, "
      f"finished={final_game['finished']}")
assert final_game["finished"] is True, "게임이 끝나지 않았습니다 (테스트 설계 오류)"
assert not any(s["finished"] for s in game_states[:-1]), "게임이 예정보다 일찍 끝났습니다"
assert final_game["score"] == 8, f"성공 8회를 기대했는데 score={final_game['score']}"


# ═══════════════════════════════════════════════════════════════
# 저장
# ═══════════════════════════════════════════════════════════════
out = {
    "calibration": {
        "input": {"width": CAL_WIDTH, "height": CAL_HEIGHT, "frames": cal_frames},
        "expected": {"states": cal_states, "final_samples": final_cal_samples},
    },
    "game": {
        "input": {
            "width": GAME_WIDTH,
            "height": GAME_HEIGHT,
            "region_points": REGION_POINTS,
            "randint_queue": randint_queue,
            "frames": game_frames,
        },
        "expected": {"states": game_states},
    },
}

dest = HERE / "fixture.json"
dest.write_text(json.dumps(out), encoding="utf-8")
print(f"기준값 생성: {dest.name}")
