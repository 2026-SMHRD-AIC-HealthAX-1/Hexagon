import json
import os
from datetime import datetime, timezone

import pymysql
import pymysql.cursors


def _connect():
    return pymysql.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# game_records.game_type 값 - S-05 시선 추적 게임과 테스트용 리듬게임을 구분한다.
GAME_TYPE_GAZE = "gaze"
GAME_TYPE_RHYTHM = "rhythm"


def init_db():
    # 타입 있는 정식 DB(MySQL)로 전환하면서 시작하는 스키마라, 예전 SQLite
    # 버전의 점진적 ALTER TABLE 마이그레이션 이력(_ensure_google_columns 등)은
    # 필요 없다 - google_sub/kakao_id 같은 컬럼도 처음부터 CREATE TABLE에 포함된다.
    # 타임스탬프는 실제 DATETIME이 아니라 기존 _now_iso()가 만드는 ISO8601
    # 문자열을 그대로 VARCHAR에 저장한다 - ISO8601은 문자열로도 시간순 정렬이
    # 되므로(ORDER BY played_at DESC 등) 그대로 옮겨도 동작이 달라지지 않는다.
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    provider VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'kakao')),
                    created_at VARCHAR(64) NOT NULL,
                    last_login_at VARCHAR(64) NOT NULL,
                    google_sub VARCHAR(255) UNIQUE,
                    kakao_id VARCHAR(255) UNIQUE,
                    email VARCHAR(255)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cursor.execute(f"""
                CREATE TABLE IF NOT EXISTS game_records (
                    game_record_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    game_type VARCHAR(20) NOT NULL DEFAULT '{GAME_TYPE_GAZE}' CHECK (game_type IN ('gaze', 'rhythm')),
                    score INT NOT NULL,
                    played_at VARCHAR(64) NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            # S-03 사진 분석 결과 (routers/analysis.py가 매 분석마다 한 행씩 기록).
            # **분석에 쓴 원본 사진은 저장하지 않는다** - 눈 사진은 개인정보라 서버에
            # 남기지 않기로 했고, 분석은 메모리에서만 이뤄진다. 여기 남는 건 분석에서
            # 나온 수치뿐이다.
            #
            # 등급 문자열("정상"/"주의 필요"/"위험")이 아니라 원본 수치를 저장하는 이유:
            # 등급은 확률에 경계값을 적용하면 언제든 다시 계산할 수 있는 파생값이라,
            # 나중에 경계값을 조정하면 저장해둔 등급과 어긋나버린다. 경계값의 단일
            # 기준은 models/cataract_cls/infer.py이고, 등급은 읽을 때 계산한다.
            # (둘 다 0~1 비율값 - 화면에 보일 때만 퍼센트로 바꾼다.)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS analysis_results (
                    analysis_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    cataract_prob FLOAT NOT NULL,
                    redness_ratio FLOAT NOT NULL,
                    analyzed_at VARCHAR(64) NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            # 웹 경로의 캘리브레이션 데이터 - 예전에는 서버 전체에 파일 하나
            # (data/calibration.json)로만 저장돼서 여러 사용자가 순서대로 캘리브레이션하면
            # 서로 덮어썼다. game.html/rhythm_game.html이 이미 로그인 필수 화면이라, 그
            # 세션 쿠키로 식별되는 user_id별로 분리 저장한다. data 컬럼엔 그 시절의
            # calibration.json이 쓰던 것과 같은 JSON 구조({version, screen, samples})를
            # 문자열로 그대로 저장 - SQL로 개별 샘플을 조회할 일이 없고 다운스트림
            # 함수들이 그 리스트 구조를 그대로 기대하기 때문에 굳이 여러 행으로
            # 정규화하지 않는다. CLI/데스크톱 모드(및 그 data/calibration.json 파일)는
            # 2026-09-15에 완전히 제거되어, 지금은 이 테이블이 캘리브레이션의 유일한
            # 저장소다.
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS calibration_data (
                    user_id BIGINT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at VARCHAR(64) NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            # 눈 깜빡임 원본 데이터 전체가 아니라, "1분간 깜빡임이 너무 적어 경고가
            # 뜬 순간"만 기록한다 - 사용자가 나중에 "얼마나 자주 경고를 받았는지"로
            # 위험한 습관 여부를 스스로 판단할 수 있게 하는 게 목적이라 그 판단에
            # 필요한 최소 데이터(발생 시각)만 남기면 충분하다.
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS blink_alerts (
                    blink_record_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    triggered_at VARCHAR(64) NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
        conn.commit()
    finally:
        conn.close()


def create_user(provider, google_sub=None, email=None, kakao_id=None):
    now = _now_iso()

    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users (provider, created_at, last_login_at, google_sub, email, kakao_id) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (provider, now, now, google_sub, email, kakao_id),
            )
            user_id = cursor.lastrowid
        conn.commit()
        return user_id
    finally:
        conn.close()


def touch_user_login(user_id, provider, email=None):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            if email is not None:
                cursor.execute(
                    "UPDATE users SET provider = %s, last_login_at = %s, email = %s WHERE id = %s",
                    (provider, _now_iso(), email, user_id),
                )
            else:
                cursor.execute(
                    "UPDATE users SET provider = %s, last_login_at = %s WHERE id = %s",
                    (provider, _now_iso(), user_id),
                )
            updated = cursor.rowcount > 0
        conn.commit()
        return updated
    finally:
        conn.close()


def get_user(user_id):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
            return cursor.fetchone()
    finally:
        conn.close()


def get_user_by_google_sub(google_sub):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE google_sub = %s", (google_sub,))
            return cursor.fetchone()
    finally:
        conn.close()


def get_user_by_kakao_id(kakao_id):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE kakao_id = %s", (kakao_id,))
            return cursor.fetchone()
    finally:
        conn.close()


def insert_game_record(user_id, score, game_type):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO game_records (user_id, game_type, score, played_at) VALUES (%s, %s, %s, %s)",
                (user_id, game_type, score, _now_iso()),
            )
        conn.commit()
    finally:
        conn.close()


def get_last_game_record(user_id, game_type):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM game_records WHERE user_id = %s AND game_type = %s "
                "ORDER BY played_at DESC LIMIT 1",
                (user_id, game_type),
            )
            return cursor.fetchone()
    finally:
        conn.close()


def save_calibration(user_id, width, height, samples):
    data = json.dumps({"version": 1, "screen": {"width": width, "height": height}, "samples": samples})

    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE calibration_data SET data = %s, updated_at = %s WHERE user_id = %s",
                (data, _now_iso(), user_id),
            )
            if cursor.rowcount == 0:
                cursor.execute(
                    "INSERT INTO calibration_data (user_id, data, updated_at) VALUES (%s, %s, %s)",
                    (user_id, data, _now_iso()),
                )
        conn.commit()
    finally:
        conn.close()


def has_calibration(user_id):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 FROM calibration_data WHERE user_id = %s LIMIT 1", (user_id,))
            return cursor.fetchone() is not None
    finally:
        conn.close()


def get_calibration_samples(user_id):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT data FROM calibration_data WHERE user_id = %s", (user_id,))
            row = cursor.fetchone()
            return json.loads(row["data"])["samples"] if row else None
    finally:
        conn.close()


def log_blink_alert(user_id):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO blink_alerts (user_id, triggered_at) VALUES (%s, %s)",
                (user_id, _now_iso()),
            )
        conn.commit()
    finally:
        conn.close()


def insert_analysis_result(user_id, cataract_prob, redness_ratio):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO analysis_results (user_id, cataract_prob, redness_ratio, analyzed_at) "
                "VALUES (%s, %s, %s, %s)",
                (user_id, cataract_prob, redness_ratio, _now_iso()),
            )
        conn.commit()
    finally:
        conn.close()


def get_last_analysis_result(user_id):
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM analysis_results WHERE user_id = %s ORDER BY analyzed_at DESC LIMIT 1",
                (user_id,),
            )
            return cursor.fetchone()
    finally:
        conn.close()


def delete_analysis_results(user_id):
    """마이페이지의 "백내장/충혈도 기록 삭제" 버튼 - 해당 사용자의 analysis_results 전체 삭제."""
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute("DELETE FROM analysis_results WHERE user_id = %s", (user_id,))
        conn.commit()
    finally:
        conn.close()


def delete_game_records(user_id, game_type):
    """마이페이지의 게임 기록 삭제 버튼 - game_type 하나만 지운다 (예: 시선 추적만, 리듬은 유지)."""
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "DELETE FROM game_records WHERE user_id = %s AND game_type = %s",
                (user_id, game_type),
            )
        conn.commit()
    finally:
        conn.close()
