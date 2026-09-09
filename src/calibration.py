import json
import time
from pathlib import Path


class Calibration:

    def __init__(self, width, height):
        self.width = width
        self.height = height

        margin_x = int(width * 0.03)
        margin_y = int(height * 0.03)

        self.points = [
            (margin_x, margin_y),
            (width // 2, margin_y),
            (width - margin_x, margin_y),

            (margin_x, height // 2),
            (width // 2, height // 2),
            (width - margin_x, height // 2),

            (margin_x, height - margin_y),
            (width // 2, height - margin_y),
            (width - margin_x, height - margin_y),
        ]

        self.current_index = 0
        self.samples = []
        self.start_time = None

    def start(self):
        self.current_index = 0
        self.samples = []
        self.start_time = time.time()

    def current_point(self):
        if self.current_index >= len(self.points):
            return None

        return self.points[self.current_index]

    def add_sample(self, gaze_x, gaze_y):

        point = self.current_point()

        if point is None:
            return

        self.samples.append({
            "screen": point,
            "gaze": (gaze_x, gaze_y)
        })

    def next_point(self):
        self.current_index += 1
        self.start_time = time.time()

    def is_finished(self):
        return self.current_index >= len(self.points)

    def save(self, path):

        data = {
            "version": 1,

            "screen": {
                "width": self.width,
                "height": self.height
            },

            "samples": self.samples
        }

        path = Path(path)

        with open(path, "w") as f:
            json.dump(
                data,
                f,
                indent=4
            )

        print(f"Calibration saved: {path}")

    @staticmethod
    def exists(path):
        return Path(path).exists()