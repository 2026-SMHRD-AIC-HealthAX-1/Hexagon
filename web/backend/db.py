import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parents[1]
DB_PATH = REPO_ROOT / "data" / "eyegod.db"


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# game_records.game_type 값 - S-05 시선 추적 게임과 테스트용 리듬게임을 구분한다.
GAME_TYPE_GAZE = "gaze"
GAME_TYPE_RHYTHM = "rhythm"


def _ensure_game_type_column(conn):
    # game_type 컬럼 추가 전에 만들어진 기존 game_records 행은 전부 시선 추적 게임
    # 기록이었으므로(리듬게임은 그때 DB에 저장하지 않았다), 마이그레이션 시 기본값을
    # 'gaze'로 채워도 실제 기록과 어긋나지 않는다.
    columns = [row["name"] for row in conn.execute("PRAGMA table_info(game_records)")]
    if "game_type" not in columns:
        conn.execute(
            f"ALTER TABLE game_records ADD COLUMN game_type TEXT NOT NULL DEFAULT '{GAME_TYPE_GAZE}'"
        )
        conn.commit()


def _ensure_google_columns(conn):
    # 실제 Google OAuth 로그인을 붙이면서 추가된 컬럼 - 이전에 만들어진 mock(카카오)
    # 사용자 행에는 값이 없는 게 정상이라 둘 다 nullable로 추가한다.
    columns = [row["name"] for row in conn.execute("PRAGMA table_info(users)")]
    if "google_sub" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
    if "email" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
    conn.commit()


def _ensure_kakao_column(conn):
    # 실제 Kakao OAuth 로그인을 붙이면서 추가된 컬럼 - google_sub와 같은 이유로 nullable.
    columns = [row["name"] for row in conn.execute("PRAGMA table_info(users)")]
    if "kakao_id" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN kakao_id TEXT")
    conn.commit()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = _connect()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_login_at TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS game_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                game_type TEXT NOT NULL DEFAULT '{GAME_TYPE_GAZE}',
                score INTEGER NOT NULL,
                played_at TEXT NOT NULL
            )
        """)
        _ensure_game_type_column(conn)
        _ensure_google_columns(conn)
        _ensure_kakao_column(conn)
        # S-03 사진 분석이 아직 실제 모델이 없어 지금은 아무 코드도 이 테이블에 쓰지 않는다.
        # 나중에 AI 모델이 붙을 때 바로 쓸 수 있도록 스키마만 미리 만들어둔다.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS analysis_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                cataract_risk TEXT,
                redness TEXT,
                analyzed_at TEXT NOT NULL
            )
        """)
        # 웹 경로의 캘리브레이션 데이터 - 예전에는 서버 전체에 파일 하나
        # (data/calibration.json)로만 저장돼서 여러 사용자가 순서대로 캘리브레이션하면
        # 서로 덮어썼다. game.html/rhythm_game.html이 이미 로그인 필수 화면이라, 그
        # 세션 쿠키로 식별되는 user_id별로 분리 저장한다. data 컬럼엔 calibration.json이
        # 쓰던 것과 같은 JSON 구조({version, screen, samples})를 문자열로 그대로 저장 -
        # SQL로 개별 샘플을 조회할 일이 없고 다운스트림 함수들이 그 리스트 구조를 그대로
        # 기대하기 때문에 굳이 여러 행으로 정규화하지 않는다. CLI/데스크톱 모드는 여전히
        # data/calibration.json 파일을 그대로 쓰며 이 테이블과 무관하다.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calibration_data (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        # 눈 깜빡임 원본 데이터 전체가 아니라, "1분간 깜빡임이 너무 적어 경고가
        # 뜬 순간"만 기록한다 - 사용자가 나중에 "얼마나 자주 경고를 받았는지"로
        # 위험한 습관 여부를 스스로 판단할 수 있게 하는 게 목적이라 그 판단에
        # 필요한 최소 데이터(발생 시각)만 남기면 충분하다.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS blink_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                triggered_at TEXT NOT NULL
            )
        """)
        conn.commit()
    finally:
        conn.close()


def create_user(provider, google_sub=None, email=None, kakao_id=None):
    now = _now_iso()

    conn = _connect()
    try:
        cursor = conn.execute(
            "INSERT INTO users (provider, created_at, last_login_at, google_sub, email, kakao_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (provider, now, now, google_sub, email, kakao_id),
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def touch_user_login(user_id, provider, email=None):
    conn = _connect()
    try:
        if email is not None:
            cursor = conn.execute(
                "UPDATE users SET provider = ?, last_login_at = ?, email = ? WHERE id = ?",
                (provider, _now_iso(), email, user_id),
            )
        else:
            cursor = conn.execute(
                "UPDATE users SET provider = ?, last_login_at = ? WHERE id = ?",
                (provider, _now_iso(), user_id),
            )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_user(user_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_google_sub(google_sub):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE google_sub = ?", (google_sub,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_kakao_id(kakao_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE kakao_id = ?", (kakao_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def insert_game_record(user_id, score, game_type):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO game_records (user_id, game_type, score, played_at) VALUES (?, ?, ?, ?)",
            (user_id, game_type, score, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()


def get_last_game_record(user_id, game_type):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM game_records WHERE user_id = ? AND game_type = ? ORDER BY played_at DESC LIMIT 1",
            (user_id, game_type),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def save_calibration(user_id, width, height, samples):
    data = json.dumps({"version": 1, "screen": {"width": width, "height": height}, "samples": samples})

    conn = _connect()
    try:
        cursor = conn.execute(
            "UPDATE calibration_data SET data = ?, updated_at = ? WHERE user_id = ?",
            (data, _now_iso(), user_id),
        )
        if cursor.rowcount == 0:
            conn.execute(
                "INSERT INTO calibration_data (user_id, data, updated_at) VALUES (?, ?, ?)",
                (user_id, data, _now_iso()),
            )
        conn.commit()
    finally:
        conn.close()


def has_calibration(user_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT 1 FROM calibration_data WHERE user_id = ? LIMIT 1", (user_id,)
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def get_calibration_samples(user_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT data FROM calibration_data WHERE user_id = ?", (user_id,)
        ).fetchone()
        return json.loads(row["data"])["samples"] if row else None
    finally:
        conn.close()


def log_blink_alert(user_id):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO blink_alerts (user_id, triggered_at) VALUES (?, ?)",
            (user_id, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
