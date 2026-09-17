import time

import db
from calibration import Calibration
from gaze import GazeSmoother, compute_gaze


class CalibrationSession:

    def __init__(self, width, height, user_id):
        self.calibration = Calibration(width, height)
        self.calibration.start()
        self.smoother = GazeSmoother(alpha=0.2)
        self.user_id = user_id

    def process(self, face_landmarks):

        gaze_x, gaze_y = compute_gaze(face_landmarks, self.smoother)

        point = self.calibration.current_point()

        if point is not None:
            elapsed = time.time() - self.calibration.start_time

            if 0.3 <= elapsed < 2.8:
                self.calibration.add_sample(gaze_x, gaze_y)

            if elapsed >= 3.0:
                self.calibration.next_point()

        finished = self.calibration.is_finished()

        if finished:
            db.save_calibration(
                self.user_id, self.calibration.width, self.calibration.height, self.calibration.samples
            )

        return {
            "type": "state",
            "point": list(point) if point is not None else None,
            "finished": finished,
        }
