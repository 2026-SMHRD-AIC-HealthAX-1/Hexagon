import random
import time

import db
from gaze import GazeSmoother, compute_gaze
from blink_monitor import BlinkMonitor
from gaze_region_classifier import (
    calculate_region_gaze,
    create_region_points,
)

GAME_DURATION_SEC = 10

LANES = ("left", "center", "right")

# 테스트 단계 하드코딩 값 - 추후 난이도 분리 시 조정 예정
NOTE_FALL_DURATION_MS = 3000
NOTE_SPAWN_MIN_INTERVAL_MS = 1600
NOTE_SPAWN_MAX_INTERVAL_MS = 3000

# 판정 윈도우: 노트의 목표 시각과 블링크 시각의 오차(diff, ms)에 따라
# perfect/great/good/miss 4단계로 나뉜다. 세 값 모두 그 이하일 때 해당
# 등급이 되는 누적 경계선이라, PERFECT_WINDOW_MS <= GREAT_WINDOW_MS <=
# GOOD_WINDOW_MS 순서를 유지해야 한다. GOOD_WINDOW_MS 는 기존 CATCH_WINDOW_MS
# 를 대체하며(이름만 바뀜, 400ms 그대로), 캐치 시도 가능 범위이자 노트 만료
# 기준 그대로다 - diff 가 이보다 크면 애초에 캐치 후보에 들지 않고, 캐치를
# 못 한 채 이 시간이 지나면 만료되어 miss 로 처리된다.
PERFECT_WINDOW_MS = 150
GREAT_WINDOW_MS = 280
GOOD_WINDOW_MS = 400
JUDGMENT_FLASH_MS = 350

SCORE_PER_PERFECT = 100
SCORE_PER_GREAT = 70
SCORE_PER_GOOD = 50


class CalibrationNotFoundError(Exception):
    pass


class _Note:
    _next_id = 1

    def __init__(self, lane, spawn_time_ms):
        self.id = _Note._next_id
        _Note._next_id += 1

        self.lane = lane
        self.spawn_time_ms = spawn_time_ms
        self.target_time_ms = spawn_time_ms + NOTE_FALL_DURATION_MS

        self.judged = False
        self.result = None
        self.result_time_ms = None


class RhythmGameSession:

    def __init__(self, user_id):

        if not db.has_calibration(user_id):
            raise CalibrationNotFoundError()

        samples = db.get_calibration_samples(user_id)
        averages = calculate_region_gaze(samples)
        region_points = create_region_points(averages)

        # gaze_region_classifier의 1~9 토폴로지 번호는 (y, x) 정렬 기준이라
        # 1,4,7=좌 / 2,5,8=중 / 3,6,9=우 열(column)에 해당한다.
        self.lane_x = {
            "left": sum(region_points[r][0] for r in (1, 4, 7)) / 3,
            "center": sum(region_points[r][0] for r in (2, 5, 8)) / 3,
            "right": sum(region_points[r][0] for r in (3, 6, 9)) / 3,
        }

        self.smoother = GazeSmoother(alpha=0.2)
        self.blink_monitor = BlinkMonitor()
        self.prev_is_blinking = False

        self.focus_lane = "center"
        self.notes = []
        self.next_spawn_at_ms = self._random_spawn_delay()

        self.score = 0
        self.perfect_count = 0
        self.great_count = 0
        self.good_count = 0
        self.miss_count = 0

        self.is_paused = False
        self.paused_elapsed_ms = 0.0
        self.pause_started_at = None

        self.start_time = time.time()
        self.last_judgment = None

    def _random_spawn_delay(self):
        return random.randint(NOTE_SPAWN_MIN_INTERVAL_MS, NOTE_SPAWN_MAX_INTERVAL_MS)

    def _elapsed_ms(self):
        now = time.time()

        paused_extra = 0.0
        if self.is_paused and self.pause_started_at is not None:
            paused_extra = now - self.pause_started_at

        return (now - self.start_time - self.paused_elapsed_ms - paused_extra) * 1000

    def pause(self):
        if not self.is_paused:
            self.is_paused = True
            self.pause_started_at = time.time()

    def resume(self):
        if self.is_paused:
            self.paused_elapsed_ms += time.time() - self.pause_started_at
            self.pause_started_at = None
            self.is_paused = False

    def _closest_lane(self, gaze_x):
        return min(LANES, key=lambda lane: abs(gaze_x - self.lane_x[lane]))

    def _spawn_notes(self, elapsed_ms):
        if elapsed_ms >= self.next_spawn_at_ms:
            lane = random.choice(LANES)
            self.notes.append(_Note(lane, elapsed_ms))
            self.next_spawn_at_ms = elapsed_ms + self._random_spawn_delay()

    def _expire_notes(self, elapsed_ms):
        for note in self.notes:
            if not note.judged and elapsed_ms - note.target_time_ms > GOOD_WINDOW_MS:
                note.judged = True
                note.result = "miss"
                note.result_time_ms = elapsed_ms
                self.miss_count += 1
                self.last_judgment = {"lane": note.lane, "result": "miss"}

        self.notes = [
            note for note in self.notes
            if not (note.judged and elapsed_ms - note.result_time_ms > JUDGMENT_FLASH_MS)
        ]

    def _attempt_catch(self, elapsed_ms):
        candidates = [
            note for note in self.notes
            if note.lane == self.focus_lane
            and not note.judged
            and abs(elapsed_ms - note.target_time_ms) <= GOOD_WINDOW_MS
        ]

        if not candidates:
            return

        note = min(candidates, key=lambda n: abs(elapsed_ms - n.target_time_ms))
        diff = abs(elapsed_ms - note.target_time_ms)

        note.judged = True
        note.result_time_ms = elapsed_ms

        # candidates 가 이미 GOOD_WINDOW_MS 이내로 걸러져 있으므로, 여기서
        # 갈리는 캐치는 항상 perfect/great/good 중 하나다 - miss 는 캐치를
        # 아예 못 하고 시간이 지나 만료됐을 때만(_expire_notes) 발생한다.
        if diff <= PERFECT_WINDOW_MS:
            note.result = "perfect"
            self.perfect_count += 1
            self.score += SCORE_PER_PERFECT
        elif diff <= GREAT_WINDOW_MS:
            note.result = "great"
            self.great_count += 1
            self.score += SCORE_PER_GREAT
        else:
            note.result = "good"
            self.good_count += 1
            self.score += SCORE_PER_GOOD

        self.last_judgment = {"lane": note.lane, "result": note.result}

    def process(self, face_landmarks):

        if self.is_paused:
            return self._build_state(self._elapsed_ms())

        gaze_x, _ = compute_gaze(face_landmarks, self.smoother)
        self.focus_lane = self._closest_lane(gaze_x)

        blink_state = self.blink_monitor.update(face_landmarks)
        is_blinking = blink_state["is_blinking"]
        blink_event = is_blinking and not self.prev_is_blinking
        self.prev_is_blinking = is_blinking

        elapsed_ms = self._elapsed_ms()

        self.last_judgment = None
        self._spawn_notes(elapsed_ms)

        if blink_event:
            self._attempt_catch(elapsed_ms)

        self._expire_notes(elapsed_ms)

        return self._build_state(elapsed_ms)

    def _build_state(self, elapsed_ms):
        remaining = max(0.0, GAME_DURATION_SEC - elapsed_ms / 1000)
        finished = remaining <= 0

        return {
            "type": "state",
            "paused": self.is_paused,
            "focus_lane": self.focus_lane,
            "notes": [
                {
                    "id": note.id,
                    "lane": note.lane,
                    "progress": min(1.3, (elapsed_ms - note.spawn_time_ms) / NOTE_FALL_DURATION_MS),
                    "result": note.result,
                }
                for note in self.notes
            ],
            "score": self.score,
            "perfect_count": self.perfect_count,
            "great_count": self.great_count,
            "good_count": self.good_count,
            "miss_count": self.miss_count,
            "last_judgment": self.last_judgment,
            "remaining": round(remaining, 1),
            "finished": finished,
        }
