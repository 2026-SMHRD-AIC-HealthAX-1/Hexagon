import cv2
import numpy as np
import mediapipe as mp


def decode_frame(frame_bytes):
    array = np.frombuffer(frame_bytes, dtype=np.uint8)
    frame = cv2.imdecode(array, cv2.IMREAD_COLOR)

    if frame is None:
        return None

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    return mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
