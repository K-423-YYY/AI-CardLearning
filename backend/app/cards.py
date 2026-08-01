import random
from contextlib import closing
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends

from . import config
from .auth import get_current_user
from .database import get_connection
from .responses import fail, ok
from .schemas import AnswerRequest, CardBatchRequest
from .zones import (
    LEVEL_TYPE_NEW,
    LEVEL_TYPE_REVIEW,
    ROLE_NEW,
    ROLE_REVIEW,
    _owned_zone,
    _zone_daily_limit,
    _zone_created_date,
    _zone_sort_mode,
    _zone_stats,
    compute_level_bounds,
    delete_cards,
    rebuild_zone_levels,
)

router = APIRouter(tags=["cards"])

STATUS_TODO = "待学"
STATUS_DONE = "成功"
STATUS_REVIEW = "重点复习"
STATUS_LEVEL_DONE = "已通关"
STATUS_LEVEL_TODO = "待闯关"
MODE_DAILY = "daily"
MODE_REPLAY = "replay"
MODE_WRONG = "wrong"


def _wrong_card_ids(conn, user_id: int, zone_id: int) -> list[int]:
    rows = conn.execute(
        """SELECT DISTINCT lr.card_id
           FROM learning_records lr
           JOIN cards c ON c.id = lr.card_id
           JOIN files f ON f.id = c.file_id
           WHERE f.zone_id = ? AND lr.user_id = ? AND lr.is_correct = 0
           ORDER BY lr.card_id""",
        (zone_id, user_id),
    ).fetchall()
    return [r["card_id"] for r in rows]


def _record_checkin(conn, user_id: int, zone_id: int, date_str: str, now: str) -> bool:
    conn.execute(
        "INSERT OR IGNORE INTO checkins (user_id, zone_id, checkin_date, created_at) VALUES (?, ?, ?, ?)",
        (user_id, zone_id, date_str, now),
    )
    return True


def _level_rows(conn, zone_id: int) -> list:
    return conn.execute(
        "SELECT * FROM levels WHERE zone_id = ? ORDER BY level_no", (zone_id,)
    ).fetchall()


def _level_role_cards(conn, zone_id: int, level_no: int, role: str | None = None) -> list[int]:
    if role:
        rows = conn.execute(
            "SELECT card_id FROM level_cards WHERE zone_id = ? AND level_no = ? AND role = ? ORDER BY id",
            (zone_id, level_no, role),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT card_id FROM level_cards WHERE zone_id = ? AND level_no = ? ORDER BY id",
            (zone_id, level_no),
        ).fetchall()
    return [row["card_id"] for row in rows]


def _due_review_ids(conn, user_id: int, zone_id: int, date_str: str) -> list[int]:
    rows = conn.execute(
        """SELECT DISTINCT card_id FROM review_schedule
           WHERE user_id = ? AND zone_id = ? AND status = 'pending' AND review_date <= ?""",
        (user_id, zone_id, date_str),
    ).fetchall()
    return [row["card_id"] for row in rows]


def _pending_new_ids(conn, zone_id: int, level_no: int) -> list[int]:
    card_ids = _level_role_cards(conn, zone_id, level_no, ROLE_NEW)
    if not card_ids:
        rows = conn.execute(
            """SELECT c.id FROM cards c JOIN files f ON f.id = c.file_id
               WHERE f.zone_id = ? AND c.level_no = ? AND c.status != ?
               ORDER BY c.id""",
            (zone_id, level_no, STATUS_DONE),
        ).fetchall()
        return [row["id"] for row in rows]
    placeholders = ",".join("?" * len(card_ids))
    rows = conn.execute(
        f"SELECT id FROM cards WHERE id IN ({placeholders}) AND status != ?",
        [*card_ids, STATUS_DONE],
    ).fetchall()
    return [row["id"] for row in rows]


def _first_actionable_level(conn, user_id: int, zone_id: int, date_str: str):
    due_ids = _due_review_ids(conn, user_id, zone_id, date_str)
    for lv in _level_rows(conn, zone_id):
        if lv["status"] == STATUS_LEVEL_DONE:
            continue
        if lv["level_type"] == LEVEL_TYPE_NEW and _pending_new_ids(conn, zone_id, lv["level_no"]):
            return lv
        if due_ids:
            return lv
    return None


def _schedule_reviews(conn, user_id: int, zone_id: int, card_id: int, date_str: str, now: str) -> None:
    conn.execute(
        """DELETE FROM review_schedule
           WHERE user_id = ? AND zone_id = ? AND card_id = ? AND status = 'pending'""",
        (user_id, zone_id, card_id),
    )
    for interval in config.REVIEW_INTERVALS:
        review_date = (date.fromisoformat(date_str) + timedelta(days=interval)).isoformat()
        conn.execute(
            """INSERT OR IGNORE INTO review_schedule
               (user_id, zone_id, card_id, review_date, status, created_at)
               VALUES (?, ?, ?, ?, 'pending', ?)""",
            (user_id, zone_id, card_id, review_date, now),
        )


def _schedule_wrong_retry(conn, user_id: int, zone_id: int, card_id: int, date_str: str, now: str) -> None:
    conn.execute(
        """DELETE FROM review_schedule
           WHERE user_id = ? AND zone_id = ? AND card_id = ? AND status = 'pending'""",
        (user_id, zone_id, card_id),
    )
    tomorrow = (date.fromisoformat(date_str) + timedelta(days=1)).isoformat()
    conn.execute(
        """INSERT OR REPLACE INTO review_schedule
           (user_id, zone_id, card_id, review_date, status, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)""",
        (user_id, zone_id, card_id, tomorrow, now),
    )


def _level_ready(conn, user_id: int, zone_id: int, level, date_str: str) -> bool:
    if level["level_type"] == LEVEL_TYPE_NEW:
        if _pending_new_ids(conn, zone_id, level["level_no"]):
            return False
    else:
        card_ids = _level_role_cards(conn, zone_id, level["level_no"], ROLE_REVIEW)
        if not card_ids:
            return True
        placeholders = ",".join("?" * len(card_ids))
        rows_count = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM review_schedule WHERE zone_id = ? AND card_id IN ({placeholders})",
            [zone_id, *card_ids],
        ).fetchone()["cnt"]
        if rows_count == 0:
            return False
        pending_count = conn.execute(
            f"""SELECT COUNT(*) AS cnt FROM review_schedule
                WHERE zone_id = ? AND status = 'pending' AND card_id IN ({placeholders})""",
            [zone_id, *card_ids],
        ).fetchone()["cnt"]
        if pending_count:
            return False
    return not _due_review_ids(conn, user_id, zone_id, date_str)


def _sync_level_statuses(conn, user_id: int, zone_id: int, date_str: str, now: str) -> None:
    for lv in _level_rows(conn, zone_id):
        if lv["status"] == STATUS_LEVEL_DONE:
            continue
        if _level_ready(conn, user_id, zone_id, lv, date_str):
            conn.execute(
                "UPDATE levels SET status = ?, completed_at = ? WHERE id = ?",
                (STATUS_LEVEL_DONE, now, lv["id"]),
            )
            _record_checkin(conn, user_id, zone_id, date_str, now)


def _has_actionable_level(conn, user_id: int, zone_id: int, date_str: str) -> bool:
    return _first_actionable_level(conn, user_id, zone_id, date_str) is not None


def _ensure_review_level_for_due(conn, user_id: int, zone_id: int, date_str: str, now: str):
    """到期复习没有可挂靠关卡时，AI 在路径末尾补一个纯复习关。"""
    due = _due_review_ids(conn, user_id, zone_id, date_str)
    if not due:
        return None
    level = conn.execute(
        """SELECT * FROM levels
           WHERE zone_id = ? AND status = ? AND level_type = ?
           ORDER BY level_no LIMIT 1""",
        (zone_id, STATUS_LEVEL_TODO, LEVEL_TYPE_REVIEW),
    ).fetchone()
    if level is None:
        max_no = conn.execute(
            "SELECT COALESCE(MAX(level_no), 0) AS m FROM levels WHERE zone_id = ?", (zone_id,)
        ).fetchone()["m"]
        level_no = max_no + 1
        day_no = max(1, (date.fromisoformat(date_str) - _zone_created_date(conn, zone_id)).days + 1)
        limit = _zone_daily_limit(conn, zone_id, user_id)
        conn.execute(
            """INSERT INTO levels
               (zone_id, level_no, level_type, day_no, new_count, daily_limit, status, completed_at, created_at)
               VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?)""",
            (zone_id, level_no, LEVEL_TYPE_REVIEW, day_no, limit, STATUS_LEVEL_TODO, now),
        )
        conn.execute(
            """INSERT INTO zone_settings (zone_id, daily_limit, level_count, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(zone_id) DO UPDATE SET level_count = excluded.level_count, updated_at = excluded.updated_at""",
            (zone_id, limit, level_no, now),
        )
        level = conn.execute(
            "SELECT * FROM levels WHERE zone_id = ? AND level_no = ?", (zone_id, level_no)
        ).fetchone()
    for card_id in due:
        conn.execute(
            """INSERT OR IGNORE INTO level_cards (zone_id, level_no, card_id, role, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (zone_id, level["level_no"], card_id, ROLE_REVIEW, now),
        )
    return level


def _option_order(card, wrong_count: int, date_str: str) -> list[str]:
    rng = random.Random(f"{card['id']}:{wrong_count}:{date_str}")
    originals = ["A", "B", "C", "D"]
    rng.shuffle(originals)
    return originals


def _shuffled_options(card, wrong_count: int, date_str: str) -> tuple[dict, str]:
    letters = ["A", "B", "C", "D"]
    options = [card["option_a"], card["option_b"], card["option_c"], card["option_d"]]
    originals = _option_order(card, wrong_count, date_str)
    mapping = {}
    for new_letter, original in zip(letters, originals):
        mapping[new_letter] = options[letters.index(original)]
    answer = next(
        new_letter for new_letter, original in zip(letters, originals) if original == card["answer"]
    )
    return mapping, answer


def _ensure_today_tasks(conn, user_id: int, zone_id: int, date_str: str):
    def fetch_rows():
        return conn.execute(
            "SELECT * FROM daily_tasks WHERE user_id = ? AND zone_id = ? AND task_date = ? ORDER BY position, id",
            (user_id, zone_id, date_str),
        ).fetchall()

    existing = fetch_rows()
    if existing:
        # 旧版本会把答错 3 次的题标记为 skipped，导致当天不再补任务；
        # 这里把它们重新放回待做队列，确保没学完还能继续做。
        skipped = [t for t in existing if t["status"] == "skipped"]
        if skipped:
            for t in skipped:
                conn.execute("UPDATE daily_tasks SET status = 'pending' WHERE id = ?", (t["id"],))
            conn.commit()
            existing = fetch_rows()
        if any(t["status"] == "pending" for t in existing):
            return existing

    level_count = conn.execute(
        "SELECT COUNT(*) AS cnt FROM levels WHERE zone_id = ?", (zone_id,)
    ).fetchone()["cnt"]
    if level_count == 0:
        rebuild_zone_levels(conn, zone_id, user_id=user_id)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _sync_level_statuses(conn, user_id, zone_id, date_str, now)
    current = _first_actionable_level(conn, user_id, zone_id, date_str)
    if current is None:
        current = _ensure_review_level_for_due(conn, user_id, zone_id, date_str, now)
    if current is None:
        return fetch_rows() or []

    new_ids = []
    if current["level_type"] == LEVEL_TYPE_NEW:
        new_ids = _pending_new_ids(conn, zone_id, current["level_no"])
    review_ids = _due_review_ids(conn, user_id, zone_id, date_str)
    random.shuffle(new_ids)
    queue_ids = list(dict.fromkeys(new_ids + review_ids))
    if not queue_ids:
        return existing if existing else []

    max_pos = conn.execute(
        "SELECT COALESCE(MAX(position), 0) AS m FROM daily_tasks WHERE user_id = ? AND zone_id = ? AND task_date = ?",
        (user_id, zone_id, date_str),
    ).fetchone()["m"]
    conn.executemany(
        """INSERT INTO daily_tasks (user_id, zone_id, card_id, task_date, status, position, level_no, mode, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, 'daily', ?)""",
        [
            (user_id, zone_id, card_id, date_str, max_pos + position, current["level_no"], now)
            for position, card_id in enumerate(queue_ids, start=1)
        ],
    )
    conn.commit()
    return fetch_rows()


@router.get("/api/zones/{zone_id}/today")
def get_today(zone_id: int, user: dict = Depends(get_current_user)):
    date_str = date.today().isoformat()
    with closing(get_connection()) as conn:
        zone = _owned_zone(conn, zone_id, user["id"])
        if zone is None:
            return fail(4040, "学习区不存在", 404)
        limit = _zone_daily_limit(conn, zone_id, user["id"])
        tasks = _ensure_today_tasks(conn, user["id"], zone_id, date_str)
        pending = [t for t in tasks if t["status"] == "pending"]
        current = _first_actionable_level(conn, user["id"], zone_id, date_str)
        completed = (not pending) and not _has_actionable_level(conn, user["id"], zone_id, date_str)
        done_count = sum(1 for t in tasks if t["status"] == "done")
        total_count = len(tasks)
        level_no = current["level_no"] if current else (tasks[0]["level_no"] if tasks else None)
        level_type = current["level_type"] if current else None
        new_total = 0
        new_done = 0
        if current and current["level_type"] == LEVEL_TYPE_NEW:
            card_ids = _level_role_cards(conn, zone_id, current["level_no"], ROLE_NEW)
            if card_ids:
                placeholders = ",".join("?" * len(card_ids))
                rows = conn.execute(
                    f"SELECT status FROM cards WHERE id IN ({placeholders})", card_ids
                ).fetchall()
                new_total = sum(1 for r in rows if r["status"] != STATUS_DONE)
            new_done = conn.execute(
                """SELECT COUNT(*) AS cnt FROM daily_tasks
                   WHERE user_id = ? AND zone_id = ? AND task_date = ? AND level_no = ? AND status = 'done'""",
                (user["id"], zone_id, date_str, current["level_no"]),
            ).fetchone()["cnt"]
        checked_in = (
            conn.execute(
                "SELECT 1 FROM checkins WHERE user_id = ? AND zone_id = ? AND checkin_date = ?",
                (user["id"], zone_id, date_str),
            ).fetchone()
            is not None
        )
        conn.commit()

        cards = []
        for t in pending:
            card = conn.execute("SELECT * FROM cards WHERE id = ?", (t["card_id"],)).fetchone()
            options, answer = _shuffled_options(card, card["wrong_count"], date_str)
            cards.append(
                {
                    "card_id": card["id"],
                    "title": card["title"],
                    "question": card["question"],
                    "options": options,
                    "answer": answer,
                    "label": card["label"],
                    "explanation": card["explanation"],
                }
            )
        return ok(
            {
                "task_date": date_str,
                "daily_limit": limit,
                "level_no": level_no,
                "level_type": level_type,
                "new_total": new_total,
                "new_done": new_done,
                "pending": cards,
                "completed": completed,
                "done_count": done_count,
                "total_count": total_count,
                "checked_in": checked_in,
            }
        )


@router.get("/api/zones/{zone_id}/levels/{level_no}/start")
def start_level(zone_id: int, level_no: int, user: dict = Depends(get_current_user)):
    date_str = date.today().isoformat()
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
        level = conn.execute(
            "SELECT * FROM levels WHERE zone_id = ? AND level_no = ?", (zone_id, level_no)
        ).fetchone()
        if level is None:
            return fail(4040, "关卡不存在", 404)
        current = _first_actionable_level(conn, user["id"], zone_id, date_str)
        mode = MODE_DAILY if current is not None and current["level_no"] == level_no else MODE_REPLAY
        if mode == MODE_DAILY:
            tasks = _ensure_today_tasks(conn, user["id"], zone_id, date_str)
            tasks = [t for t in tasks if t["level_no"] == level_no]
            pending = [t for t in tasks if t["status"] == "pending"]
            done_count = sum(1 for t in tasks if t["status"] == "done")
            total_count = len(tasks)
        else:
            new_ids = _level_role_cards(conn, zone_id, level_no, ROLE_NEW)
            review_ids = _level_role_cards(conn, zone_id, level_no, ROLE_REVIEW)
            if not new_ids and not review_ids:
                rows = conn.execute(
                    """SELECT c.id FROM cards c JOIN files f ON f.id = c.file_id
                       WHERE f.zone_id = ? AND c.level_no = ? ORDER BY c.id""",
                    (zone_id, level_no),
                ).fetchall()
                queue_ids = [row["id"] for row in rows]
            else:
                queue_ids = new_ids + [cid for cid in review_ids if cid not in new_ids]
            pending = [{"card_id": cid, "status": "pending", "level_no": level_no} for cid in queue_ids]
            done_count = 0
            total_count = len(queue_ids)

        cards = []
        for t in pending:
            card = conn.execute("SELECT * FROM cards WHERE id = ?", (t["card_id"],)).fetchone()
            options, answer = _shuffled_options(card, card["wrong_count"], date_str)
            cards.append(
                {
                    "card_id": card["id"],
                    "title": card["title"],
                    "question": card["question"],
                    "options": options,
                    "answer": answer,
                    "label": card["label"],
                    "explanation": card["explanation"],
                    "level_no": t["level_no"],
                }
            )
        return ok(
            {
                "level": {
                    "level_no": level["level_no"],
                    "name": level["name"],
                    "level_type": level["level_type"],
                    "day_no": level["day_no"],
                    "new_count": level["new_count"],
                    "status": level["status"],
                },
                "mode": mode,
                "cards": cards,
                "total_count": total_count,
                "done_count": done_count,
                "completed": not cards,
            }
        )


@router.post("/api/cards/{card_id}/answer")
def submit_answer(card_id: int, body: AnswerRequest, user: dict = Depends(get_current_user)):
    date_str = date.today().isoformat()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    option = body.option.strip().upper()
    with closing(get_connection()) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            card = conn.execute(
                "SELECT c.*, f.zone_id FROM cards c JOIN files f ON f.id = c.file_id WHERE c.id = ?",
                (card_id,),
            ).fetchone()
            if card is None:
                return fail(4040, "卡片不存在", 404)
            zone = _owned_zone(conn, card["zone_id"], user["id"])
            if zone is None:
                return fail(4030, "无权操作该卡片", 403)

            mode = body.mode or MODE_DAILY
            practice = mode == MODE_WRONG
            replay = mode == MODE_REPLAY
            task = None
            if not practice and not replay:
                task = conn.execute(
                    """SELECT * FROM daily_tasks
                       WHERE user_id = ? AND zone_id = ? AND card_id = ? AND task_date = ? AND mode = 'daily'
                       ORDER BY id LIMIT 1""",
                    (user["id"], card["zone_id"], card_id, date_str),
                ).fetchone()
                if task is None or task["status"] != "pending":
                    return fail(4090, "该卡片不在今日任务中或已完成", 409)
                if body.level_no is not None and task["level_no"] is not None and task["level_no"] != body.level_no:
                    return fail(4090, "关卡上下文不匹配", 409)

            level_no = task["level_no"] if task is not None else (body.level_no or card["level_no"])
            _, displayed_answer = _shuffled_options(card, card["wrong_count"], date_str)
            correct = option == displayed_answer
            next_options = None
            next_answer = None
            conn.execute(
                """INSERT INTO learning_records (card_id, user_id, is_correct, level_no, answered_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (card_id, user["id"], 1 if correct else 0, level_no, now),
            )
            card_status = card["status"]
            if correct:
                if not replay:
                    if task is not None:
                        conn.execute("UPDATE daily_tasks SET status = 'done' WHERE id = ?", (task["id"],))
                    if not practice:
                        if card["status"] != STATUS_DONE:
                            conn.execute("UPDATE cards SET status = ? WHERE id = ?", (STATUS_DONE, card_id))
                            card_status = STATUS_DONE
                        _schedule_reviews(conn, user["id"], card["zone_id"], card_id, date_str, now)
                        remaining = conn.execute(
                            """SELECT COUNT(*) AS cnt FROM cards c
                               JOIN files f ON f.id = c.file_id
                               WHERE f.zone_id = ? AND c.status != ?""",
                            (card["zone_id"], STATUS_DONE),
                        ).fetchone()["cnt"]
                        if remaining == 0:
                            conn.execute(
                                "UPDATE learning_zones SET status = '已完成', updated_at = ? WHERE id = ?",
                                (now, card["zone_id"]),
                            )
                        _sync_level_statuses(conn, user["id"], card["zone_id"], date_str, now)
            else:
                if not replay:
                    conn.execute("UPDATE cards SET wrong_count = wrong_count + 1 WHERE id = ?", (card_id,))
                    if not practice:
                        wrong_today = conn.execute(
                            """SELECT COUNT(*) AS cnt FROM learning_records
                               WHERE card_id = ? AND user_id = ? AND is_correct = 0
                                 AND substr(answered_at, 1, 10) = ?""",
                            (card_id, user["id"], date_str),
                        ).fetchone()["cnt"]
                        if wrong_today >= 3:
                            conn.execute("UPDATE cards SET status = ? WHERE id = ?", (STATUS_REVIEW, card_id))
                            card_status = STATUS_REVIEW
                        _schedule_wrong_retry(conn, user["id"], card["zone_id"], card_id, date_str, now)
                    if task is not None:
                        others = conn.execute(
                            """SELECT id FROM daily_tasks
                               WHERE user_id = ? AND zone_id = ? AND task_date = ? AND status = 'pending' AND id != ?
                               ORDER BY position""",
                            (user["id"], card["zone_id"], date_str, task["id"]),
                        ).fetchall()
                        conn.execute(
                            "UPDATE daily_tasks SET position = ? WHERE id = ?",
                            (len(others) + 1, task["id"]),
                        )
                next_options, next_answer = _shuffled_options(card, card["wrong_count"] + 1, date_str)
            conn.commit()
        except Exception:  # noqa: BLE001
            conn.rollback()
            raise

    return ok(
        {
            "correct": correct,
            "answer": displayed_answer,
            "explanation": card["explanation"],
            "card_status": card_status,
            "wrong_count": card["wrong_count"] + (0 if correct else 1),
            "next_options": next_options,
            "next_answer": next_answer,
            "level_no": level_no,
            "mode": mode,
        }
    )


@router.get("/api/zones/{zone_id}/wrong-cards")
def wrong_cards(zone_id: int, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
        rows = conn.execute(
            """SELECT c.id, c.title, c.question, c.option_a, c.option_b, c.option_c, c.option_d,
                      c.answer, c.explanation, c.label, c.status, c.wrong_count,
                      COUNT(lr.id) AS wrong_times, MAX(lr.answered_at) AS last_wrong
               FROM learning_records lr
               JOIN cards c ON c.id = lr.card_id
               JOIN files f ON f.id = c.file_id
               WHERE f.zone_id = ? AND lr.user_id = ? AND lr.is_correct = 0
               GROUP BY c.id
               ORDER BY last_wrong DESC""",
            (zone_id, user["id"]),
        ).fetchall()
        return ok({"wrong_cards": [dict(r) for r in rows]})


@router.post("/api/cards/batch-delete")
def batch_delete_cards(body: CardBatchRequest, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        ids = list(dict.fromkeys(body.card_ids))
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"""SELECT c.id, f.zone_id FROM cards c
                JOIN files f ON f.id = c.file_id
                WHERE c.id IN ({placeholders})""",
            ids,
        ).fetchall()
        found = {row["id"]: row["zone_id"] for row in rows}
        missing = [cid for cid in ids if cid not in found]
        if missing:
            return fail(4040, "部分卡片不存在", 404)
        zone_ids = set(found.values())
        for zone_id in zone_ids:
            if _owned_zone(conn, zone_id, user["id"]) is None:
                return fail(4030, "无权操作这些卡片", 403)

        conn.execute("BEGIN IMMEDIATE")
        try:
            total = 0
            for zone_id in zone_ids:
                zone_card_ids = [cid for cid, zid in found.items() if zid == zone_id]
                total += delete_cards(conn, zone_id, zone_card_ids)
                rebuild_zone_levels(conn, zone_id, user_id=user["id"], preserve_completed=True)
            conn.commit()
            return ok({"deleted": total})
        except Exception:  # noqa: BLE001
            conn.rollback()
            raise


@router.post("/api/cards/batch-review")
def batch_review_cards(body: CardBatchRequest, user: dict = Depends(get_current_user)):
    date_str = date.today().isoformat()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with closing(get_connection()) as conn:
        ids = list(dict.fromkeys(body.card_ids))
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"""SELECT c.id, f.zone_id FROM cards c
                JOIN files f ON f.id = c.file_id
                WHERE c.id IN ({placeholders})""",
            ids,
        ).fetchall()
        found = {row["id"]: row["zone_id"] for row in rows}
        if [cid for cid in ids if cid not in found]:
            return fail(4040, "部分卡片不存在", 404)
        zone_ids = set(found.values())
        for zone_id in zone_ids:
            if _owned_zone(conn, zone_id, user["id"]) is None:
                return fail(4030, "无权操作这些卡片", 403)

        added = 0
        for zone_id in zone_ids:
            current = _first_actionable_level(conn, user["id"], zone_id, date_str)
            level_no = current["level_no"] if current else None
            zone_card_ids = [cid for cid, zid in found.items() if zid == zone_id]
            for card_id in zone_card_ids:
                task = conn.execute(
                    """SELECT id, status FROM daily_tasks
                       WHERE user_id = ? AND zone_id = ? AND card_id = ? AND task_date = ?""",
                    (user["id"], zone_id, card_id, date_str),
                ).fetchone()
                max_pos = conn.execute(
                    "SELECT COALESCE(MAX(position), 0) AS m FROM daily_tasks WHERE user_id = ? AND zone_id = ? AND task_date = ?",
                    (user["id"], zone_id, date_str),
                ).fetchone()["m"]
                if task is not None and task["status"] == "pending":
                    continue
                if task is not None:
                    conn.execute(
                        "UPDATE daily_tasks SET status = 'pending', position = ?, level_no = ?, mode = 'daily' WHERE id = ?",
                        (max_pos + 1, level_no, task["id"]),
                    )
                else:
                    conn.execute(
                        """INSERT INTO daily_tasks (user_id, zone_id, card_id, task_date, status, position, level_no, mode, created_at)
                           VALUES (?, ?, ?, ?, 'pending', ?, ?, 'daily', ?)""",
                        (user["id"], zone_id, card_id, date_str, max_pos + 1, level_no, now),
                    )
                added += 1
        conn.commit()
        return ok({"added": added, "total": len(ids)})


@router.get("/api/zones/{zone_id}/wrong-practice")
def wrong_practice_cards(zone_id: int, user: dict = Depends(get_current_user)):
    date_str = date.today().isoformat()
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
        rows = conn.execute(
            """SELECT c.id
               FROM learning_records lr
               JOIN cards c ON c.id = lr.card_id
               JOIN files f ON f.id = c.file_id
               WHERE f.zone_id = ? AND lr.user_id = ? AND lr.is_correct = 0
               GROUP BY c.id
               ORDER BY MAX(lr.answered_at) DESC""",
            (zone_id, user["id"]),
        ).fetchall()
        cards = []
        for row in rows:
            card = conn.execute("SELECT * FROM cards WHERE id = ?", (row["id"],)).fetchone()
            options, answer = _shuffled_options(card, card["wrong_count"], date_str)
            cards.append(
                {
                    "card_id": card["id"],
                    "title": card["title"],
                    "question": card["question"],
                    "options": options,
                    "answer": answer,
                    "label": card["label"],
                    "explanation": card["explanation"],
                }
            )
        return ok({"cards": cards, "total": len(cards)})


@router.post("/api/zones/{zone_id}/wrong-practice")
def wrong_practice(zone_id: int, user: dict = Depends(get_current_user)):
    date_str = date.today().isoformat()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
        card_ids = _wrong_card_ids(conn, user["id"], zone_id)
        added = 0
        for card_id in card_ids:
            task = conn.execute(
                """SELECT id, status FROM daily_tasks
                   WHERE user_id = ? AND zone_id = ? AND card_id = ? AND task_date = ?""",
                (user["id"], zone_id, card_id, date_str),
            ).fetchone()
            max_pos = conn.execute(
                "SELECT COALESCE(MAX(position), 0) AS m FROM daily_tasks WHERE user_id = ? AND zone_id = ? AND task_date = ?",
                (user["id"], zone_id, date_str),
            ).fetchone()["m"]
            if task is not None and task["status"] == "pending":
                continue
            if task is not None:
                conn.execute(
                    "UPDATE daily_tasks SET status = 'pending', position = ? WHERE id = ?",
                    (max_pos + 1, task["id"]),
                )
            else:
                conn.execute(
                    """INSERT INTO daily_tasks (user_id, zone_id, card_id, task_date, status, position, created_at)
                       VALUES (?, ?, ?, ?, 'pending', ?, ?)""",
                    (user["id"], zone_id, card_id, date_str, max_pos + 1, now),
                )
            added += 1
        conn.commit()
        return ok({"added": added, "total_wrong": len(card_ids)})


@router.get("/api/zones/{zone_id}/progress")
def zone_progress(zone_id: int, user: dict = Depends(get_current_user)):
    date_str = date.today().isoformat()
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
        limit = _zone_daily_limit(conn, zone_id, user["id"])
        stats = _zone_stats(conn, zone_id)
        total = stats["total"]
        done = stats["success"]
        level_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM levels WHERE zone_id = ?", (zone_id,)
        ).fetchone()["cnt"]
        if level_count == 0:
            rebuild_zone_levels(conn, zone_id, user_id=user["id"])
            conn.commit()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        _sync_level_statuses(conn, user["id"], zone_id, date_str, now)
        _ensure_review_level_for_due(conn, user["id"], zone_id, date_str, now)
        levels = conn.execute(
            "SELECT * FROM levels WHERE zone_id = ? ORDER BY level_no", (zone_id,)
        ).fetchall()
        total_levels = max(1, len(levels)) if total > 0 else 0
        completed_levels = sum(1 for lv in levels if lv["status"] == STATUS_LEVEL_DONE)
        actionable = _first_actionable_level(conn, user["id"], zone_id, date_str)
        current_row = actionable or next(
            (lv for lv in levels if lv["status"] == STATUS_LEVEL_TODO), None
        )
        current_level = current_row["level_no"] if current_row else total_levels
        level_path = []
        for lv in levels:
            new_ids = _level_role_cards(conn, zone_id, lv["level_no"], ROLE_NEW)
            review_ids = _level_role_cards(conn, zone_id, lv["level_no"], ROLE_REVIEW)
            all_ids = list(dict.fromkeys(new_ids + review_ids))
            if not all_ids:
                rows = conn.execute(
                    """SELECT c.id FROM cards c JOIN files f ON f.id = c.file_id
                       WHERE f.zone_id = ? AND c.level_no = ? ORDER BY c.id""",
                    (zone_id, lv["level_no"]),
                ).fetchall()
                all_ids = [row["id"] for row in rows]
                new_ids = list(all_ids)
            new_set = set(new_ids)
            review_set = set(review_ids)
            block_name = ""
            if new_ids:
                np2 = ",".join("?" * len(new_ids))
                block_row = conn.execute(
                    f"""SELECT block_name FROM cards
                        WHERE id IN ({np2}) AND block_name != '' ORDER BY sort_order, id LIMIT 1""",
                    new_ids,
                ).fetchone()
                block_name = block_row["block_name"] if block_row else ""
            placeholders = ",".join("?" * len(all_ids))
            card_rows = conn.execute(
                f"SELECT id, status FROM cards WHERE id IN ({placeholders})", all_ids
            ).fetchall()
            card_count = len(card_rows)
            done_cards = sum(1 for r in card_rows if r["status"] == STATUS_DONE)
            new_total = sum(1 for r in card_rows if r["id"] in new_set and r["status"] != STATUS_DONE)
            new_done = 0
            if new_ids:
                np = ",".join("?" * len(new_ids))
                new_done = conn.execute(
                    f"""SELECT COUNT(*) AS cnt FROM daily_tasks
                        WHERE user_id = ? AND zone_id = ? AND task_date = ? AND level_no = ? AND status = 'done'
                          AND card_id IN ({np})""",
                    [user["id"], zone_id, date_str, lv["level_no"], *new_ids],
                ).fetchone()["cnt"]
            due_reviews = 0
            next_review = None
            if review_set:
                rp = ",".join("?" * len(review_ids))
                due_reviews = conn.execute(
                    f"""SELECT COUNT(DISTINCT card_id) AS cnt FROM review_schedule
                        WHERE user_id = ? AND zone_id = ? AND status = 'pending' AND review_date <= ?
                          AND card_id IN ({rp})""",
                    [user["id"], zone_id, date_str, *review_ids],
                ).fetchone()["cnt"]
                next_review = conn.execute(
                    f"""SELECT MIN(review_date) AS review_date FROM review_schedule
                        WHERE user_id = ? AND zone_id = ? AND status = 'pending'
                          AND card_id IN ({rp})""",
                    [user["id"], zone_id, *review_ids],
                ).fetchone()["review_date"]
            level_path.append(
                {
                    "level_no": lv["level_no"],
                    "name": lv["name"],
                    "block_name": block_name,
                    "level_type": lv["level_type"],
                    "day_no": lv["day_no"],
                    "new_count": lv["new_count"],
                    "status": lv["status"],
                    "daily_limit": lv["daily_limit"],
                    "card_count": card_count,
                    "done_cards": done_cards,
                    "new_total": new_total,
                    "new_done": new_done,
                    "due_reviews": due_reviews,
                    "next_review": next_review,
                    "completed_at": lv["completed_at"],
                }
            )

        tasks = conn.execute(
            "SELECT status FROM daily_tasks WHERE user_id = ? AND zone_id = ? AND task_date = ?",
            (user["id"], zone_id, date_str),
        ).fetchall()
        pending_cnt = sum(1 for t in tasks if t["status"] == "pending")
        more_levels = any(lv["status"] == STATUS_LEVEL_TODO for lv in levels)
        today_done = not _has_actionable_level(conn, user["id"], zone_id, date_str) or (
            bool(tasks) and all(t["status"] == "done" for t in tasks) and not more_levels
        )

        review_today = conn.execute(
            """SELECT COUNT(DISTINCT card_id) AS cnt FROM review_schedule
               WHERE user_id = ? AND zone_id = ? AND review_date <= ? AND status = 'pending'""",
            (user["id"], zone_id, date_str),
        ).fetchone()["cnt"]

        bounds = compute_level_bounds(conn, zone_id, user["id"])
        sort_mode = _zone_sort_mode(conn, zone_id)
        zs = conn.execute("SELECT level_count FROM zone_settings WHERE zone_id = ?", (zone_id,)).fetchone()
        selected = zs["level_count"] if zs else None
        if selected is not None and bounds["upper"] > 0:
            selected = max(bounds["lower"], min(bounds["upper"], selected))
        today_new_total = 0
        today_new_done = 0
        if actionable and actionable["level_type"] == LEVEL_TYPE_NEW:
            today_new_total = next(
                (lv["new_total"] for lv in level_path if lv["level_no"] == actionable["level_no"]), 0
            )
            today_new_done = next(
                (lv["new_done"] for lv in level_path if lv["level_no"] == actionable["level_no"]), 0
            )

        checked_today = (
            conn.execute(
                "SELECT 1 FROM checkins WHERE user_id = ? AND zone_id = ? AND checkin_date = ?",
                (user["id"], zone_id, date_str),
            ).fetchone()
            is not None
        )
        streak = 0
        d = date.today()
        while True:
            ds = d.isoformat()
            row = conn.execute(
                "SELECT 1 FROM checkins WHERE user_id = ? AND zone_id = ? AND checkin_date = ?",
                (user["id"], zone_id, ds),
            ).fetchone()
            if row is None:
                break
            streak += 1
            d -= timedelta(days=1)

        week = []
        for i in range(6, -1, -1):
            ds = (date.today() - timedelta(days=i)).isoformat()
            row = conn.execute(
                "SELECT 1 FROM checkins WHERE user_id = ? AND zone_id = ? AND checkin_date = ?",
                (user["id"], zone_id, ds),
            ).fetchone()
            week.append({"date": ds, "checked": row is not None})

        return ok(
            {
                "total_cards": total,
                "done_cards": done,
                "daily_limit": limit,
                "sort_mode": sort_mode,
                "total_levels": total_levels,
                "completed_levels": completed_levels,
                "new_levels": sum(1 for lv in levels if lv["level_type"] == LEVEL_TYPE_NEW),
                "review_levels": sum(1 for lv in levels if lv["level_type"] == LEVEL_TYPE_REVIEW),
                "current_level": current_level,
                "levels": level_path,
                "layout": {
                    **bounds,
                    "selected": selected,
                },
                "today_pending": pending_cnt,
                "today_done": today_done,
                "today_new_total": today_new_total,
                "today_new_done": today_new_done,
                "review_today": review_today,
                "checked_today": checked_today,
                "streak": streak,
                "week": week,
            }
        )
