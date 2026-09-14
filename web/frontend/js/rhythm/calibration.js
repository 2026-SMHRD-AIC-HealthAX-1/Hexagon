/*
  캘리브레이션 데이터를 받아 리듬게임이 쓰는 좌/중/우 기준값(laneX)으로 바꾼다.

  서버판 rhythm_game_session.py 의 __init__ 이 하던 일과 동일하다:
      samples -> calculate_region_gaze -> create_region_points
      -> 1,4,7 / 2,5,8 / 3,6,9 열의 x 평균
  이 유도식이 파이썬판과 같은 숫자를 내는지는 tests/vision_parity 에서
  검증한다 (lane_x 항목).
*/

import { calculateRegionGaze, createRegionPoints } from "../vision/gazeRegionClassifier.js";

/**
 * @returns {Promise<{left:number, center:number, right:number} | null>}
 *   캘리브레이션이 없으면 null.
 */
export async function fetchLaneX() {
  const response = await fetch("/api/calibration");

  if (response.status === 401) {
    throw new Error("로그인이 필요합니다.");
  }
  if (!response.ok) {
    throw new Error(`캘리브레이션 조회 실패 (${response.status})`);
  }

  const data = await response.json();
  if (!data.has_calibration || !data.samples.length) {
    return null;
  }

  const regionPoints = createRegionPoints(calculateRegionGaze(data.samples));

  // gaze_region_classifier 의 1~9 토폴로지 번호는 (y, x) 정렬 기준이라
  // 1,4,7=좌 / 2,5,8=중 / 3,6,9=우 열(column)에 해당한다.
  const columnAverage = (regions) =>
    regions.reduce((sum, r) => sum + regionPoints[r][0], 0) / regions.length;

  return {
    left: columnAverage([1, 4, 7]),
    center: columnAverage([2, 5, 8]),
    right: columnAverage([3, 6, 9]),
  };
}
