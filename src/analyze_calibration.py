import json
import statistics
from collections import defaultdict
import matplotlib.pyplot as plt

CALIBRATION_FILE = "data/calibration.json"


def main():

    # JSON 불러오기
    with open(CALIBRATION_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    # screen 좌표별로 gaze 데이터 묶기
    grouped = defaultdict(list)

    for sample in data["samples"]:

        screen = tuple(sample["screen"])
        gaze = sample["gaze"]

        grouped[screen].append(gaze)

    # print("=" * 70)
    # print("Calibration Gaze Analysis")
    # print("=" * 70)

    # all_gaze_x = []
    # all_gaze_y = []

    # # 화면 좌표별 분석
    # for screen, gazes in grouped.items():

    #     gaze_x = [g[0] for g in gazes]
    #     gaze_y = [g[1] for g in gazes]

    #     all_gaze_x.extend(gaze_x)
    #     all_gaze_y.extend(gaze_y)

    #     mean_x = statistics.mean(gaze_x)
    #     mean_y = statistics.mean(gaze_y)

    #     median_x = statistics.median(gaze_x)
    #     median_y = statistics.median(gaze_y)

    #     std_x = statistics.stdev(gaze_x) if len(gaze_x) > 1 else 0
    #     std_y = statistics.stdev(gaze_y) if len(gaze_y) > 1 else 0

    #     min_x = min(gaze_x)
    #     max_x = max(gaze_x)

    #     min_y = min(gaze_y)
    #     max_y = max(gaze_y)

    #     print()
    #     print(f"Screen: {screen}")
    #     print(f"Samples: {len(gazes)}")

    #     print(
    #         f"  Gaze X : "
    #         f"mean={mean_x:.4f}, "
    #         f"median={median_x:.4f}, "
    #         f"std={std_x:.4f}, "
    #         f"range=({min_x:.4f} ~ {max_x:.4f})"
    #     )

    #     print(
    #         f"  Gaze Y : "
    #         f"mean={mean_y:.4f}, "
    #         f"median={median_y:.4f}, "
    #         f"std={std_y:.4f}, "
    #         f"range=({min_y:.4f} ~ {max_y:.4f})"
    #     )

    # print()
    # print("=" * 70)
    # print("Overall")
    # print("=" * 70)

    # print(f"Total samples: {len(data['samples'])}")

    # print(
    #     f"Gaze X range: "
    #     f"{min(all_gaze_x):.4f} ~ {max(all_gaze_x):.4f}"
    # )

    # print(
    #     f"Gaze Y range: "
    #     f"{min(all_gaze_y):.4f} ~ {max(all_gaze_y):.4f}"
    # )

    plt.figure(figsize=(10, 7))

    for screen, gazes in grouped.items():

        gaze_x = [g[0] for g in gazes]
        gaze_y = [g[1] for g in gazes]

        plt.scatter(
            gaze_x,
            gaze_y,
            label=str(screen),
            alpha=0.5
        )

    plt.xlabel("Gaze X")
    plt.ylabel("Gaze Y")
    plt.title("Calibration Gaze Distribution")

    plt.legend()
    plt.grid(True)

    plt.show()

if __name__ == "__main__":
    main()