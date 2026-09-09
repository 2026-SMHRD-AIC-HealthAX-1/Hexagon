import time

import db
from gaze import GazeSmoother, compute_gaze
from gaze_game import GazeGame
from gaze_region_classifier import (
    GazeRegionClassifier,
    calculate_region_gaze,
    create_region_points,
)


class CalibrationNotFoundError(Exception):
    pass


class GameSession:

    def __init__(self, width, height, user_id):

        if not db.has_calibration(user_id):
            raise CalibrationNotFoundError()

        samples = db.get_calibration_samples(user_id)
        averages = calculate_region_gaze(samples)
        region_points = create_region_points(averages)

        self.classifier = GazeRegionClassifier(region_points)

        self.game = GazeGame(width, height)
        self.game.next_target()

        self.smoother = GazeSmoother(alpha=0.2)

    def process(self, face_landmarks):

        gaze_x, gaze_y = compute_gaze(face_landmarks, self.smoother)

        gaze_region = self.classifier.predict(gaze_x, gaze_y)

        if self.game.check_gaze(gaze_region):
            self.game.handle_success()

        finished = self.game.is_finished()
        remaining = max(0, self.game.time_limit - (time.time() - self.game.start_time))
        rect = self.game.get_target_rect()

        return {
            "type": "state",
            "target": self.game.current_target,
            "rect": list(rect) if rect is not None else None,
            "region": gaze_region,
            "score": self.game.score,
            "remaining": round(remaining, 1),
            "finished": finished,
        }
