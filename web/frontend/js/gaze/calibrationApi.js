/*
  캘리브레이션 결과(9포인트 샘플)를 서버 DB에 저장한다.

  서버판 CalibrationSession.process() 는 완료되는 순간 db.save_calibration()
  을 직접 호출했지만, 여기서는 계산이 브라우저에서 끝나므로 HTTP 로 넘겨서
  같은 일을 하게 한다 (POST /api/calibration, routers/calibration_api.py).
  리듬게임(js/rhythm/calibration.js)이 쓰는 GET /api/calibration 과 짝을
  이루는 쓰기 엔드포인트다.
*/
export async function saveCalibration(width, height, samples) {
  const response = await fetch("/api/calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ width, height, samples }),
  });

  if (response.status === 401) {
    throw new Error("로그인이 필요합니다.");
  }
  if (!response.ok) {
    throw new Error(`캘리브레이션 저장 실패 (${response.status})`);
  }
}
