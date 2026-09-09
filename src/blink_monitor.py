import math
import time


class BlinkMonitor:

    def __init__(self, threshold=0.20):

        self.threshold = threshold

        # 현재 눈 감김 상태
        self.left_closed = False
        self.right_closed = False

        # 깜빡임 상태
        self.is_blinking = False

        # 통계
        self.blink_count = 0

        self.blink_start_time = None
        self.last_blink_time = None

        self.blink_durations = []
        self.blink_intervals = []

    def _distance(self, p1, p2):

        return math.sqrt(
            (p1.x - p2.x) ** 2 +
            (p1.y - p2.y) ** 2
        )

    def _calculate_ear(self, landmarks, eye):

        p1 = landmarks[eye[0]]
        p2 = landmarks[eye[1]]
        p3 = landmarks[eye[2]]
        p4 = landmarks[eye[3]]
        p5 = landmarks[eye[4]]
        p6 = landmarks[eye[5]]

        vertical_1 = self._distance(p2, p6)
        vertical_2 = self._distance(p3, p5)

        horizontal = self._distance(p1, p4)

        if horizontal == 0:
            return 0.0

        ear = (
            vertical_1 + vertical_2
        ) / (2.0 * horizontal)

        return ear

    def update(self, landmarks):

        # MediaPipe Face Landmarker eye landmark
        left_eye = [
            33,
            160,
            158,
            133,
            153,
            144
        ]

        right_eye = [
            362,
            385,
            387,
            263,
            373,
            380
        ]

        left_ear = self._calculate_ear(
            landmarks,
            left_eye
        )

        right_ear = self._calculate_ear(
            landmarks,
            right_eye
        )

        ear = (left_ear + right_ear) / 2.0

        left_closed = left_ear < self.threshold
        right_closed = right_ear < self.threshold

        eyes_closed = left_closed and right_closed

        now = time.time()

        # 눈을 감기 시작
        if eyes_closed and not self.is_blinking:

            self.is_blinking = True
            self.blink_start_time = now

        # 눈을 다시 뜸
        elif not eyes_closed and self.is_blinking:

            self.is_blinking = False

            blink_duration = (
                now - self.blink_start_time
            )

            self.blink_durations.append(
                blink_duration
            )

            # 이전 깜빡임과의 간격
            if self.last_blink_time is not None:

                interval = (
                    now - self.last_blink_time
                )

                self.blink_intervals.append(
                    interval
                )

            self.last_blink_time = now

            self.blink_count += 1

        self.left_closed = left_closed
        self.right_closed = right_closed

        return {
            "ear": ear,
            "left_ear": left_ear,
            "right_ear": right_ear,
            "is_blinking": self.is_blinking,
            "blink_count": self.blink_count
        }