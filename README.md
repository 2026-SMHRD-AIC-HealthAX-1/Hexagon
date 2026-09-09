# Eye God

안구 건조증 기반 백내장 위험 조기 예측 서비스

웹캠으로 눈 깜빡임과 시선을 추적해 눈 건강을 관리하는 서비스입니다. 원래는 데스크톱 CLI 도구(MediaPipe 기반 시선 추적)로 시작했고, 지금은 브라우저에서 쓸 수 있는 웹 서비스로 확장되고 있습니다.

## 주요 기능

- **시선 추적 미니게임** — 웹캠으로 캘리브레이션 후, 화면의 목표 지점을 시선으로 맞추는 게임
- **테스트용 리듬게임** — 시선 좌/중/우 이동 + 눈 깜빡임으로 즐기는 리듬게임
- **눈 깜빡임 모니터링** — 실시간 깜빡임 감지, 저조할 때 배너/OS 알림으로 경고
- **안약 알림 타이머** — 지정한 주기마다 안약 사용 알림
- **내 주변 안과 찾기** — 위치 기반 안과 검색 + 지도 표시
- **로그인 / 마이페이지** — Google, Kakao 실제 OAuth 로그인, 게임 기록 조회

## 기술 스택

- **Backend**: FastAPI, SQLite (stdlib `sqlite3`), MediaPipe Face Landmarker (Tasks API)
- **Frontend**: 순수 HTML/CSS/JS (빌드 도구 없음)
- **CV**: OpenCV, MediaPipe

## 실행 방법

```bash
python -m venv eye
source eye/bin/activate   # Windows: eye\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # 값 채우기 (아래 참고)
```

### CLI / 데스크톱 모드

```bash
python src/main.py --calibrate   # 1. 캘리브레이션
python src/main.py               # 2. 시선 추적 게임
python src/main.py --blink       # 눈 깜빡임 모니터링 (콘솔 출력)
```

### 웹 모드

```bash
uvicorn web.backend.app:app --reload
```

`http://localhost:8000`으로 접속 (Google/Kakao 로그인 리다이렉트가 `localhost` 기준이라 `127.0.0.1`로는 로그인 불가).

## 환경 변수 (`.env`)

`SESSION_SECRET_KEY`만 있으면 서버가 뜹니다. 나머지(`GOOGLE_CLIENT_ID`/`KAKAO_CLIENT_ID` 등)는 없어도 해당 기능만 비활성화되고 나머지는 정상 동작합니다. 자세한 설명은 `.env.example` 참고.

## 문서

- [`CLAUDE.md`](CLAUDE.md) — 아키텍처와 설계 결정을 정리한 상세 개발 문서
- [`doc/`](doc/) — 테이블 명세서, 데이터베이스 요구사항분석서, 화면설계서
- [`WINDOWS_TEST_GUIDE.txt`](WINDOWS_TEST_GUIDE.txt) — Windows 환경 테스트 가이드
