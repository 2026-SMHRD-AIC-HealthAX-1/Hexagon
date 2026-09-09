import json
from collections import Counter

with open("data/calibration.json", "r", encoding="utf-8") as f:
    data = json.load(f)

screens = [
    tuple(sample["screen"])
    for sample in data["samples"]
]

counter = Counter(screens)

print("Calibration screen points:", len(counter))
print()

for screen, count in counter.items():
    print(f"{screen}: {count} samples")