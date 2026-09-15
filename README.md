# Eye God

안구 건조증 기반 백내장 위험 조기 예측 서비스

웹캠으로 눈 깜빡임과 시선을 추적해 눈 건강을 관리하는 브라우저 기반 서비스입니다. MediaPipe Face Landmarker로 시선/깜빡임을 계산하는 CV 로직(`src/`)에 FastAPI 웹 서비스(`web/`)를 얹은 구조이며, 웹으로만 동작합니다 — 별도의 데스크톱/CLI 실행 모드는 없습니다.

## 주요 기능

- **캘리브레이션** — 화면의 9개 지점을 순서대로 바라보며 개인별 시선 기준값 측정 (로그인 계정별로 저장, 두 미니게임이 공유)
- **시선 추적 미니게임** — 저장된 캘리브레이션으로, 화면의 목표 지점을 시선으로 맞추는 게임
- **시선 추적 리듬게임** — 시선 좌/중/우 이동 + 눈 깜빡임으로 노트를 맞추는 리듬게임
- **눈 깜빡임 모니터링** — 실시간 깜빡임 감지, 저조할 때 배너/OS 알림으로 경고
- **안약 알림 타이머** — 지정한 주기마다 안약 사용 알림
- **내 주변 안과 찾기** — 위치 기반 안과 검색 + 지도 표시
- **로그인 / 마이페이지** — Google, Kakao 실제 OAuth 로그인, 게임 기록 조회

## 기술 스택

- **Backend**: FastAPI, MySQL (`PyMySQL`), MediaPipe Face Landmarker (Tasks API)
- **Frontend**: 순수 HTML/CSS/JS (빌드 도구 없음), 브라우저에서 직접 MediaPipe(WASM)를 돌려 시선/깜빡임 계산
- **CV**: OpenCV, MediaPipe

## 실행 방법

```bash
python -m venv eye
source eye/bin/activate   # Windows: eye\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # 값 채우기 (아래 참고)
```

MySQL 서버(로컬 인스턴스면 무엇이든 가능)와 그 위의 전용 데이터베이스/사용자가 필요합니다 — 자세한 내용은 [`CLAUDE.md`](CLAUDE.md)의 "Database" 항목 참고.

```bash
uvicorn web.backend.app:app --reload
```

`http://localhost:8000`으로 접속 (Google/Kakao 로그인 리다이렉트가 `localhost` 기준이라 `127.0.0.1`로는 로그인 불가).

시선추적 게임/리듬게임/캘리브레이션이 쓰는 브라우저용 MediaPipe 자산(`web/frontend/vendor/mediapipe/`)은 저장소에 포함되어 있지 않은데, 최초 실행 시 서버가 자동으로 내려받는다(인터넷 연결 필요, 수 초~수 분 소요, 이후 재기동부터는 건너뜀). 실패하면 콘솔 로그를 보고 `python scripts/setup_mediapipe.py`를 수동으로 실행하면 된다.

## 환경 변수 (`.env`)

`SESSION_SECRET_KEY`와 `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`(MySQL 접속 정보)이 있어야 서버가 뜹니다. 나머지(`GOOGLE_CLIENT_ID`/`KAKAO_CLIENT_ID` 등)는 없어도 해당 기능만 비활성화되고 나머지는 정상 동작합니다. 자세한 설명은 `.env.example` 참고.

## 문서

- [`CLAUDE.md`](CLAUDE.md) — 아키텍처와 설계 결정을 정리한 상세 개발 문서
- [`doc/`](doc/) — 테이블 명세서, 데이터베이스 요구사항분석서, 화면설계서
- [`WINDOWS_TEST_GUIDE.txt`](WINDOWS_TEST_GUIDE.txt) — Windows 환경 테스트 가이드
