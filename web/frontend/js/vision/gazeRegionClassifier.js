/*
  src/gaze_region_classifier.py 의 JS 포팅.

  ★ 이 파일이 이번 포팅에서 가장 조용히 틀리기 쉬운 곳이다. 두 가지 함정:

  (1) 파이썬은 tuple(sample["screen"]) 을 dict 키로 쓴다. JS 배열은 값이 같아도
      서로 다른 키가 되므로([100,200] !== [100,200]) 그대로 옮기면 모든 샘플이
      제각각 다른 그룹이 되어 평균이 망가진다. -> 문자열로 직렬화해서 그룹핑.

  (2) 파이썬은 sorted(..., key=lambda item: (item[0][1], item[0][0])) 로
      "화면 y 우선, 그 다음 x" 정렬해서 1~9 번호를 매긴다. JS 의 기본 .sort()
      는 문자열 비교라 숫자 비교자를 직접 주지 않으면 순서가 뒤섞인다.
      -> 이게 틀리면 에러 없이 좌/우 레인이 뒤바뀐다.

  두 함정 모두 예외를 던지지 않고 "그럴듯한 오답"을 내므로, 반드시 파이썬과의
  수치 일치 테스트로 확인할 것.

  자료구조 참고: 파이썬은 dict{(x,y): (gx,gy)} 를 쓰지만 JS 에는 값 기반 튜플
  키가 없어서 [{screen:[x,y], gaze:[gx,gy]}, ...] 배열로 표현한다.
  최종 산출물(createRegionPoints 의 반환값)은 파이썬과 동일하다.
*/

/** 같은 화면 좌표에 찍힌 샘플들의 gaze 평균을 낸다. */
export function calculateRegionGaze(samples) {
  const groups = new Map();

  for (const sample of samples) {
    const screenX = sample.screen[0];
    const screenY = sample.screen[1];
    const key = `${screenX},${screenY}`; // (1) 튜플 키 대용

    if (!groups.has(key)) {
      groups.set(key, { screen: [screenX, screenY], gazes: [] });
    }
    groups.get(key).gazes.push(sample.gaze);
  }

  const averages = [];

  for (const { screen, gazes } of groups.values()) {
    let sumX = 0;
    let sumY = 0;
    for (const gaze of gazes) {
      sumX += gaze[0];
      sumY += gaze[1];
    }
    averages.push({ screen, gaze: [sumX / gazes.length, sumY / gazes.length] });
  }

  return averages;
}

/** 화면 좌표를 (y, x) 순으로 정렬해 1~9 영역 번호를 부여한다. */
export function createRegionPoints(averages) {
  const sorted = [...averages].sort(
    // (2) 반드시 숫자 비교. y 먼저, 같으면 x.
    (a, b) => a.screen[1] - b.screen[1] || a.screen[0] - b.screen[0]
  );

  const regionPoints = {};
  sorted.forEach((item, index) => {
    regionPoints[index + 1] = item.gaze;
  });

  return regionPoints;
}

/** 가장 가까운 영역 중심을 찾는다 (시선추적 게임용 - 리듬게임은 쓰지 않음). */
export class GazeRegionClassifier {
  constructor(regionPoints) {
    this.regionPoints = regionPoints;
  }

  predict(gazeX, gazeY) {
    let bestRegion = null;
    let bestDistance = Infinity;

    for (const region of Object.keys(this.regionPoints)) {
      const [pointX, pointY] = this.regionPoints[region];
      const dist = Math.sqrt((gazeX - pointX) ** 2 + (gazeY - pointY) ** 2);

      if (dist < bestDistance) {
        bestDistance = dist;
        bestRegion = Number(region);
      }
    }

    return bestRegion;
  }
}
