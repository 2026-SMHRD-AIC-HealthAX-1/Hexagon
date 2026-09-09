from landmarks import RIGHT_EYE, RIGHT_IRIS, LEFT_EYE, LEFT_IRIS


def get_landmark_xy(face_landmarks, index):
    landmark = face_landmarks[index]

    return landmark.x, landmark.y


def get_eye_bounds(face_landmarks, eye_indices):
    xs = []
    ys = []

    for index in eye_indices:
        x, y = get_landmark_xy(face_landmarks, index)

        xs.append(x)
        ys.append(y)

    return (
        min(xs),
        max(xs),
        min(ys),
        max(ys)
    )


def get_iris_center(face_landmarks, iris_indices):
    xs = []
    ys = []

    for index in iris_indices:
        x, y = get_landmark_xy(face_landmarks, index)

        xs.append(x)
        ys.append(y)

    return (
        sum(xs) / len(xs),
        sum(ys) / len(ys)
    )


def normalize_iris_position(
    iris_x,
    iris_y,
    eye_bounds
):
    eye_left, eye_right, eye_top, eye_bottom = eye_bounds

    eye_width = eye_right - eye_left
    eye_height = eye_bottom - eye_top

    if eye_width == 0 or eye_height == 0:
        return 0.5, 0.5

    gaze_x = (iris_x - eye_left) / eye_width
    gaze_y = (iris_y - eye_top) / eye_height

    return gaze_x, gaze_y

class GazeSmoother:

    def __init__(self, alpha=0.2):
        self.alpha = alpha

        self.x = None
        self.y = None

    def update(self, x, y):

        if self.x is None:
            self.x = x
            self.y = y

        else:
            self.x = (
                self.alpha * x
                + (1 - self.alpha) * self.x
            )

            self.y = (
                self.alpha * y
                + (1 - self.alpha) * self.y
            )

        return self.x, self.y


def compute_gaze(face_landmarks, smoother):
    right_eye_bounds = get_eye_bounds(face_landmarks, RIGHT_EYE)
    left_eye_bounds = get_eye_bounds(face_landmarks, LEFT_EYE)

    right_iris_x, right_iris_y = get_iris_center(face_landmarks, RIGHT_IRIS)
    left_iris_x, left_iris_y = get_iris_center(face_landmarks, LEFT_IRIS)

    right_gaze_x, right_gaze_y = normalize_iris_position(
        right_iris_x, right_iris_y, right_eye_bounds
    )
    left_gaze_x, left_gaze_y = normalize_iris_position(
        left_iris_x, left_iris_y, left_eye_bounds
    )

    gaze_x = (right_gaze_x + left_gaze_x) / 2
    gaze_y = (right_gaze_y + left_gaze_y) / 2

    return smoother.update(gaze_x, gaze_y)