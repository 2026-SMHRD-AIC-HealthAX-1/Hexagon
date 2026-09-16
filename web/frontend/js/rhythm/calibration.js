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
 * 캘리브레이션 샘플(POST/GET /api/calibration 이 주고받는 것과 같은 형태)을
 * 좌/중/우 기준값으로 바꾼다. rhythm_game.js 가 새로 캘리브레이션을 막
 * 마친 직후(저장 응답을 다시 조회하지 않고) 그 자리에서 laneX 를 구할 때도
 * 이 함수를 그대로 쓴다.
 *
 * @param {Array<{screen:[number,number], gaze:[number,number]}>} samples
 * @returns {{left:number, center:number, right:number}}
 */
export function computeLaneX(samples) {
  const regionPoints = createRegionPoints(calculateRegionGaze(samples));

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

  return computeLaneX(data.samples);
}
