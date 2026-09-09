from blink_monitor import BlinkMonitor


class BlinkSession:

    def __init__(self):
        self.monitor = BlinkMonitor()

    def process(self, face_landmarks):

        result = self.monitor.update(face_landmarks)

        return {
            "type": "state",
            "is_blinking": result["is_blinking"],
            "blink_count": result["blink_count"],
            "ear": round(result["ear"], 3),
        }
