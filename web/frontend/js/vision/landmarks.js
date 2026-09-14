/*
  src/landmarks.py 의 JS 포팅.

  MediaPipe Face Landmarker 의 랜드마크 인덱스 상수. 파이썬판과 값이 완전히
  같아야 하며(브라우저와 서버가 같은 face_landmarker.task 모델을 쓰므로 인덱스
  의미도 동일), 한쪽만 바꾸면 조용히 결과가 갈라진다.

  ※ 468~477 홍채(iris) 인덱스는 478점 모델에서만 존재한다.
    이 프로젝트가 쓰는 models/face_landmarker.task 가 그 모델이다.
*/

export const RIGHT_EYE = [
  7, 33, 144, 145, 153,
  154, 155, 157, 158, 159,
  160, 161, 163, 173, 246,
];

export const RIGHT_IRIS = [468, 469, 470, 471, 472];

export const LEFT_EYE = [
  249, 263, 373, 374, 380,
  381, 382, 384, 385, 386,
  387, 388, 390, 398, 466,
];

export const LEFT_IRIS = [473, 474, 475, 476, 477];
