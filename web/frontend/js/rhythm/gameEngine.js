/*
  web/backend/sessions/rhythm_game_session.py 의 JS 포팅.

  서버가 하던 노트 스폰/낙하/판정/점수 계산을 브라우저에서 그대로 수행한다.
  상수와 판정 규칙은 파이썬판과 동일하게 맞춰놨다 - 한쪽만 바꾸면 두 버전의
  난이도가 조용히 달라진다.

  출력(buildState)은 서버가 WebSocket 으로 보내던 payload 와 완전히 같은 모양이라,
  렌더러(js/rhythm/renderer.js)는 서버판이든 JS판이든 구분 없이 그릴 수 있다.

  ※ 단위: 파이썬은 time.time()(초)로 재서 마지막에 1000을 곱했지만, 여기서는
    performance.now()(밀리초)로 처음부터 끝까지 ms 로 계산한다. 동작은 같다.
*/

export const GAME_DURATION_SEC = 30;

export const LANES = ["left", "center", "right"];

// 테스트 단계 하드코딩 값 - rhythm_game_session.py 와 반드시 같아야 한다
export const NOTE_FALL_DURATION_MS = 3000;
const NOTE_SPAWN_MIN_INTERVAL_MS = 1600;
const NOTE_SPAWN_MAX_INTERVAL_MS = 3000;

// 판정 윈도우: PERFECT_WINDOW_MS <= GREAT_WINDOW_MS <= GOOD_WINDOW_MS 순서의
// 누적 경계선. GOOD_WINDOW_MS 가 캐치 시도/노트 만료 기준(구 CATCH_WINDOW_MS)이다.
const PERFECT_WINDOW_MS = 150;
const GREAT_WINDOW_MS = 280;
const GOOD_WINDOW_MS = 400;
const JUDGMENT_FLASH_MS = 350;

const SCORE_PER_PERFECT = 100;
const SCORE_PER_GREAT = 70;
const SCORE_PER_GOOD = 50;

export class CalibrationNotFoundError extends Error {
  constructor() {
    super("캘리브레이션 데이터가 없습니다.");
    this.name = "CalibrationNotFoundError";
  }
}

let nextNoteId = 1;

class Note {
  constructor(lane, spawnTimeMs) {
    this.id = nextNoteId++;
    this.lane = lane;
    this.spawnTimeMs = spawnTimeMs;
    this.targetTimeMs = spawnTimeMs + NOTE_FALL_DURATION_MS;

    this.judged = false;
    this.result = null;
    this.resultTimeMs = null;
  }
}

/** 파이썬 random.randint(a, b) 는 양끝 포함이다. */
function randintInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * 파이썬 round(x, 1) 과 같은 결과를 낸다.
 *
 * Math.round(x * 10) / 10 을 쓰면 안 된다 - 파이썬 round() 는 값의 십진
 * 표현을 보고 반올림하는데, 곱셈 후 Math.round 는 이진 오차가 증폭되어
 * 결과가 한 칸 어긋나는 경우가 생긴다 (예: 29.95 -> 파이썬 29.9, JS 30).
 * toFixed 는 십진 표현 기준이라 파이썬과 일치한다.
 */
function roundTo1(value) {
  return Number(value.toFixed(1));
}

export class RhythmGameEngine {
  /**
   * @param {{left:number, center:number, right:number}} laneX
   *   캘리브레이션에서 유도한 좌/중/우 기준 gaze x 값.
   *   서버판은 생성자에서 DB를 읽어 직접 계산했지만, 브라우저에서는 미리
   *   계산해서 넘겨준다 (js/rhythm/calibration.js 참고).
   * @param {{computeGaze:Function, smoother:object, blinkMonitor:object,
   *          now?:Function, randint?:Function, choice?:Function}} deps
   *   now/randint/choice 는 테스트에서 시간과 난수를 고정하기 위한 주입점이다.
   *   (tests/rhythm_parity 가 파이썬판과 판정 결과를 비교할 때 사용)
   *   실제 실행에서는 넘기지 않으면 performance.now()/Math.random() 을 쓴다.
   */
  constructor(laneX, deps) {
    if (!laneX) {
      throw new CalibrationNotFoundError();
    }

    this.laneX = laneX;

    this.computeGaze = deps.computeGaze;
    this.smoother = deps.smoother;
    this.blinkMonitor = deps.blinkMonitor;
    this.prevIsBlinking = false;

    this._now = deps.now || (() => performance.now());
    this._randint = deps.randint || randintInclusive;
    this._choice = deps.choice || randomChoice;

    this.focusLane = "center";
    this.notes = [];
    this.nextSpawnAtMs = this._randomSpawnDelay();

    this.score = 0;
    this.perfectCount = 0;
    this.greatCount = 0;
    this.goodCount = 0;
    this.missCount = 0;

    this.isPaused = false;
    this.pausedElapsedMs = 0;
    this.pauseStartedAt = null;

    this.startTime = this._now();
    this.lastJudgment = null;
  }

  _randomSpawnDelay() {
    return this._randint(NOTE_SPAWN_MIN_INTERVAL_MS, NOTE_SPAWN_MAX_INTERVAL_MS);
  }

  _elapsedMs() {
    const now = this._now();

    let pausedExtra = 0;
    if (this.isPaused && this.pauseStartedAt !== null) {
      pausedExtra = now - this.pauseStartedAt;
    }

    return now - this.startTime - this.pausedElapsedMs - pausedExtra;
  }

  pause() {
    if (!this.isPaused) {
      this.isPaused = true;
      this.pauseStartedAt = this._now();
    }
  }

  resume() {
    if (this.isPaused) {
      this.pausedElapsedMs += this._now() - this.pauseStartedAt;
      this.pauseStartedAt = null;
      this.isPaused = false;
    }
  }

  _closestLane(gazeX) {
    let best = LANES[0];
    let bestDist = Infinity;

    for (const lane of LANES) {
      const dist = Math.abs(gazeX - this.laneX[lane]);
      if (dist < bestDist) {
        bestDist = dist;
        best = lane;
      }
    }

    return best;
  }

  _spawnNotes(elapsedMs) {
    if (elapsedMs >= this.nextSpawnAtMs) {
      this.notes.push(new Note(this._choice(LANES), elapsedMs));
      this.nextSpawnAtMs = elapsedMs + this._randomSpawnDelay();
    }
  }

  _expireNotes(elapsedMs) {
    for (const note of this.notes) {
      if (!note.judged && elapsedMs - note.targetTimeMs > GOOD_WINDOW_MS) {
        note.judged = true;
        note.result = "miss";
        note.resultTimeMs = elapsedMs;
        this.missCount += 1;
        this.lastJudgment = { lane: note.lane, result: "miss" };
      }
    }

    this.notes = this.notes.filter(
      (note) => !(note.judged && elapsedMs - note.resultTimeMs > JUDGMENT_FLASH_MS)
    );
  }

  _attemptCatch(elapsedMs) {
    const candidates = this.notes.filter(
      (note) =>
        note.lane === this.focusLane &&
        !note.judged &&
        Math.abs(elapsedMs - note.targetTimeMs) <= GOOD_WINDOW_MS
    );

    if (candidates.length === 0) {
      return;
    }

    let note = candidates[0];
    let bestDiff = Math.abs(elapsedMs - note.targetTimeMs);
    for (const candidate of candidates) {
      const diff = Math.abs(elapsedMs - candidate.targetTimeMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        note = candidate;
      }
    }

    note.judged = true;
    note.resultTimeMs = elapsedMs;

    // candidates 가 이미 GOOD_WINDOW_MS 이내로 걸러져 있으므로, 여기서 갈리는
    // 캐치는 항상 perfect/great/good 중 하나다 - miss 는 만료(_expireNotes)로만 나온다.
    if (bestDiff <= PERFECT_WINDOW_MS) {
      note.result = "perfect";
      this.perfectCount += 1;
      this.score += SCORE_PER_PERFECT;
    } else if (bestDiff <= GREAT_WINDOW_MS) {
      note.result = "great";
      this.greatCount += 1;
      this.score += SCORE_PER_GREAT;
    } else {
      note.result = "good";
      this.goodCount += 1;
      this.score += SCORE_PER_GOOD;
    }

    this.lastJudgment = { lane: note.lane, result: note.result };
  }

  /**
   * 한 프레임 처리. faceLandmarks 는 MediaPipe 가 준 배열({x,y,z} 들).
   * 서버판 process(face_landmarks) 와 동일한 역할이며 반환값도 같은 모양이다.
   */
  process(faceLandmarks) {
    if (this.isPaused) {
      return this.buildState(this._elapsedMs());
    }

    const [gazeX] = this.computeGaze(faceLandmarks, this.smoother);
    this.focusLane = this._closestLane(gazeX);

    const blinkState = this.blinkMonitor.update(faceLandmarks);
    const isBlinking = blinkState.is_blinking;
    const blinkEvent = isBlinking && !this.prevIsBlinking;
    this.prevIsBlinking = isBlinking;

    const elapsedMs = this._elapsedMs();

    this.lastJudgment = null;
    this._spawnNotes(elapsedMs);

    if (blinkEvent) {
      this._attemptCatch(elapsedMs);
    }

    this._expireNotes(elapsedMs);

    return this.buildState(elapsedMs);
  }

  buildState(elapsedMs) {
    const remaining = Math.max(0, GAME_DURATION_SEC - elapsedMs / 1000);

    return {
      type: "state",
      paused: this.isPaused,
      focus_lane: this.focusLane,
      notes: this.notes.map((note) => ({
        id: note.id,
        lane: note.lane,
        progress: Math.min(1.3, (elapsedMs - note.spawnTimeMs) / NOTE_FALL_DURATION_MS),
        result: note.result,
      })),
      score: this.score,
      perfect_count: this.perfectCount,
      great_count: this.greatCount,
      good_count: this.goodCount,
      miss_count: this.missCount,
      last_judgment: this.lastJudgment,
      remaining: roundTo1(remaining),
      finished: remaining <= 0,
    };
  }
}
