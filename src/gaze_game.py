import random
import cv2
import time
import numpy as np

class GazeGame:

    def __init__(self, width, height):

        self.width = width
        self.height = height

        # 화면을 3 x 3 영역으로 나눔
        self.region_width = width // 3
        self.region_height = height // 3
        
        # 현재 목표 영역
        self.current_target = None

        # 목표 영역 응시 시작 시간
        self.gaze_start_time = None

        # 목표 영역을 유지해야 하는 시간 (초)
        self.required_gaze_time = 0.5
        
        self.score = 0
        
        self.time_limit = 30
        self.start_time = time.time()

    def get_region(self, x, y):

        # 가로 방향 영역
        col = int(x / self.region_width)

        # 세로 방향 영역
        row = int(y / self.region_height)

        # 화면 바깥으로 나가는 경우 방지
        col = max(0, min(col, 2))
        row = max(0, min(row, 2))

        # 0~8 → 1~9
        region = row * 3 + col + 1

        return region
    
    def next_target(self):

        # 첫 번째 목표라면 1~9 중 랜덤
        if self.current_target is None:

            self.current_target = random.randint(1, 9)

        else:

            previous = self.current_target

            # 이전과 다른 영역 선택
            while True:

                target = random.randint(1, 9)

                if target != previous:
                    break

            self.current_target = target

        return self.current_target
    
    def get_target_rect(self):

        if self.current_target is None:
            return None

        # 현재 목표 영역의 행/열 계산
        target = self.current_target - 1

        row = target // 3
        col = target % 3

        # 목표 영역의 좌표
        x1 = int(col * self.region_width)
        y1 = int(row * self.region_height)

        x2 = int((col + 1) * self.region_width)
        y2 = int((row + 1) * self.region_height)

        return (x1, y1, x2, y2)

    def draw(self, frame):

        rect = self.get_target_rect()

        if rect is None:
            return frame

        x1, y1, x2, y2 = rect

        # 목표 영역 표시
        cv2.rectangle(
            frame,
            (x1, y1),
            (x2, y2),
            (255, 255, 255),
            5
        )

        elapsed_time = time.time() - self.start_time
        remaining_time = max(
            0,
            self.time_limit - elapsed_time
        )
        
        cv2.putText(
            frame,
            f"Time: {remaining_time:.1f}s",
            (self.width - 250, 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (255, 255, 255),
            2
        )
        
        return frame
    
    def is_finished(self):
        return time.time() - self.start_time >= self.time_limit
    
    
    def check_gaze(self, gaze_region):

        # 아직 목표가 없다면 검사하지 않음
        if self.current_target is None:
            return False

        # 현재 바라보는 영역이 목표 영역이라면
        if gaze_region == self.current_target:

            # 처음 목표 영역에 들어온 순간
            if self.gaze_start_time is None:
                self.gaze_start_time = time.time()

            # 목표 영역을 얼마나 오래 바라봤는지
            elapsed = time.time() - self.gaze_start_time

            # 요구 시간 이상 유지했는지
            if elapsed >= self.required_gaze_time:
                return True

        else:

            # 목표 영역에서 벗어나면 시간 초기화
            self.gaze_start_time = None

        return False

    def handle_success(self):

        self.score += 1

        # 다음 목표 선택
        self.next_target()

        # 새로운 목표에 대한 응시 시간 초기화
        self.gaze_start_time = None
        
if __name__ == "__main__":

    game = GazeGame(900, 600)

    game.next_target()

    frame = np.zeros(
        (600, 900, 3),
        dtype=np.uint8
    )

    frame = game.draw(frame)

    cv2.imshow("Gaze Game Test", frame)

    cv2.waitKey(0)
    cv2.destroyAllWindows()