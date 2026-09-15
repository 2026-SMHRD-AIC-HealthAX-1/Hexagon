import math

class GazeRegionClassifier:
    def __init__(self, region_points):
        self.region_points = region_points

    def predict(self, gaze_x, gaze_y):

        best_region = None
        best_distance = float("inf")

        for region, point in self.region_points.items():

            point_x, point_y = point

            distance = math.sqrt(
                (gaze_x - point_x) ** 2 +
                (gaze_y - point_y) ** 2
            )

            if distance < best_distance:
                best_distance = distance
                best_region = region

        return best_region
    

def calculate_region_gaze(samples):

    region_gaze = {}

    for sample in samples:

        screen = tuple(sample["screen"])
        gaze = sample["gaze"]

        if screen not in region_gaze:
            region_gaze[screen] = []

        region_gaze[screen].append(gaze)

    # 각 calibration 위치의 평균 gaze
    averages = {}

    for screen, gazes in region_gaze.items():

        avg_x = sum(g[0] for g in gazes) / len(gazes)
        avg_y = sum(g[1] for g in gazes) / len(gazes)

        averages[screen] = (avg_x, avg_y)

    return averages

def create_region_points(averages):

    # 화면 좌표 기준으로 정렬
    sorted_points = sorted(
        averages.items(),
        key=lambda item: (item[0][1], item[0][0])
    )

    region_points = {}

    for region, (_, gaze) in enumerate(sorted_points, start=1):
        region_points[region] = gaze

    return region_points