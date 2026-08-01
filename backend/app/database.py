import json
import sqlite3
from contextlib import closing
from datetime import datetime

from . import config
from .models import SCHEMA


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DATABASE_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _ensure_card_level_no(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(cards)").fetchall()}
    if "level_no" not in columns:
        conn.execute("ALTER TABLE cards ADD COLUMN level_no INTEGER NOT NULL DEFAULT 1")


def _add_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _ensure_schema_columns(conn: sqlite3.Connection) -> None:
    _add_column(conn, "levels", "level_type", "TEXT NOT NULL DEFAULT '新学'")
    _add_column(conn, "levels", "name", "TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "levels", "day_no", "INTEGER")
    _add_column(conn, "levels", "new_count", "INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "cards", "block_name", "TEXT NOT NULL DEFAULT ''")
    _add_column(conn, "cards", "difficulty", "TEXT NOT NULL DEFAULT '中'")
    _add_column(conn, "cards", "sort_order", "INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "learning_records", "level_no", "INTEGER")
    _add_column(conn, "daily_tasks", "level_no", "INTEGER")
    _add_column(conn, "daily_tasks", "mode", "TEXT NOT NULL DEFAULT 'daily'")
    _add_column(conn, "zone_settings", "level_count", "INTEGER")
    _add_column(conn, "zone_settings", "sort_mode", "TEXT NOT NULL DEFAULT 'easy_to_hard'")
    conn.execute("UPDATE cards SET sort_order = id WHERE sort_order = 0")


def _migrate_legacy_levels(conn: sqlite3.Connection) -> None:
    """老库里的旧关卡统一补成“新学关”，并生成关卡-卡片映射。"""
    has_review_level = conn.execute(
        "SELECT 1 FROM levels WHERE level_type = '复习' LIMIT 1"
    ).fetchone()
    if has_review_level:
        return
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    levels = conn.execute("SELECT id, zone_id, level_no, daily_limit FROM levels ORDER BY zone_id, level_no").fetchall()
    for level in levels:
        conn.execute(
            """UPDATE levels
               SET level_type = '新学', day_no = ?, new_count = ?, daily_limit = ?
               WHERE id = ?""",
            (level["level_no"], level["daily_limit"], level["daily_limit"], level["id"]),
        )
        exists = conn.execute(
            "SELECT 1 FROM level_cards WHERE zone_id = ? AND level_no = ? LIMIT 1",
            (level["zone_id"], level["level_no"]),
        ).fetchone()
        if exists:
            continue
        card_ids = conn.execute(
            """SELECT c.id FROM cards c
               JOIN files f ON f.id = c.file_id
               WHERE f.zone_id = ? AND c.level_no = ?
               ORDER BY c.id""",
            (level["zone_id"], level["level_no"]),
        ).fetchall()
        conn.executemany(
            """INSERT INTO level_cards (zone_id, level_no, card_id, role, created_at)
               VALUES (?, ?, ?, '新学', ?)""",
            [(level["zone_id"], level["level_no"], row["id"], now) for row in card_ids],
        )


def _migrate_level_reviews(conn: sqlite3.Connection) -> None:
    """把老版按整关的复习记录迁移成按卡片的 review_schedule，并补出复习关。"""
    if conn.execute("SELECT 1 FROM review_schedule LIMIT 1").fetchone():
        return
    reviews = conn.execute(
        """SELECT lr.user_id, lr.zone_id, lr.level_no, lr.review_date, lr.status, lr.created_at
           FROM level_reviews lr ORDER BY lr.zone_id, lr.review_date, lr.level_no"""
    ).fetchall()
    if not reviews:
        return
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for review in reviews:
        card_ids = conn.execute(
            """SELECT card_id FROM level_cards
               WHERE zone_id = ? AND level_no = ?""",
            (review["zone_id"], review["level_no"]),
        ).fetchall()
        status = "done" if review["status"] == "done" else "pending"
        conn.executemany(
            """INSERT OR IGNORE INTO review_schedule
               (user_id, zone_id, card_id, review_date, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [(review["user_id"], review["zone_id"], row["card_id"], review["review_date"], status, now) for row in card_ids],
        )

    zones = conn.execute("SELECT id, created_at FROM learning_zones").fetchall()
    for zone in zones:
        if conn.execute(
            "SELECT 1 FROM levels WHERE zone_id = ? AND level_type = '复习' LIMIT 1", (zone["id"],)
        ).fetchone():
            continue
        rows = conn.execute(
            """SELECT review_date, status, GROUP_CONCAT(card_id) AS card_ids
               FROM review_schedule WHERE zone_id = ? GROUP BY review_date ORDER BY review_date""",
            (zone["id"],),
        ).fetchall()
        base_day = datetime.strptime(zone["created_at"][:10], "%Y-%m-%d").date()
        max_no = conn.execute(
            "SELECT COALESCE(MAX(level_no), 0) AS m FROM levels WHERE zone_id = ?", (zone["id"],)
        ).fetchone()["m"]
        for row in rows:
            review_date = datetime.strptime(row["review_date"], "%Y-%m-%d").date()
            day_no = max(1, (review_date - base_day).days + 1)
            card_ids = [int(x) for x in (row["card_ids"] or "").split(",") if x]
            if not card_ids:
                continue
            max_no += 1
            level_status = "已通关" if row["status"] == "done" else "待闯关"
            completed_at = now if level_status == "已通关" else None
            conn.execute(
                """INSERT INTO levels (zone_id, level_no, level_type, day_no, new_count, daily_limit, status, completed_at, created_at)
                   VALUES (?, ?, '复习', ?, 0, 0, ?, ?, ?)""",
                (zone["id"], max_no, day_no, level_status, completed_at, now),
            )
            conn.executemany(
                """INSERT OR IGNORE INTO level_cards (zone_id, level_no, card_id, role, created_at)
                   VALUES (?, ?, ?, '复习', ?)""",
                [(zone["id"], max_no, card_id, now) for card_id in card_ids],
            )
        total = conn.execute(
            "SELECT COUNT(*) AS cnt FROM levels WHERE zone_id = ?", (zone["id"],)
        ).fetchone()["cnt"]
        conn.execute(
            """INSERT INTO zone_settings (zone_id, daily_limit, level_count, updated_at)
               VALUES (?, 5, ?, ?)
               ON CONFLICT(zone_id) DO UPDATE SET level_count = excluded.level_count, updated_at = excluded.updated_at""",
            (zone["id"], total, now),
        )


def _backfill_levels(conn: sqlite3.Connection) -> None:
    # 旧库没有关卡数据时，按现有卡片和每日限额重建关卡
    from .zones import rebuild_zone_levels

    zone_ids = [row["id"] for row in conn.execute("SELECT id FROM learning_zones").fetchall()]
    for zone_id in zone_ids:
        has_levels = conn.execute(
            "SELECT 1 FROM levels WHERE zone_id = ? LIMIT 1", (zone_id,)
        ).fetchone()
        if not has_levels:
            rebuild_zone_levels(conn, zone_id)


def _clear_legacy_preset_models(conn: sqlite3.Connection) -> None:
    """清掉旧版本自动预填的服务商模型，避免升级后仍显示“初始模型”。"""
    for provider_id, model_list in config.LEGACY_PRESET_MODELS.items():
        if not model_list:
            continue
        candidates = []
        candidates.append(json.dumps([{"name": m, "model": m} for m in model_list], ensure_ascii=False))
        candidates.append(json.dumps(model_list, ensure_ascii=False))
        placeholders = ",".join("?" for _ in candidates)
        conn.execute(
            f"UPDATE provider_configs SET models_json = '[]' WHERE provider_id = ? AND models_json IN ({placeholders})",
            (provider_id, *candidates),
        )
        conn.execute(
            f"UPDATE provider_configs SET fetched_models_json = '[]' WHERE provider_id = ? AND fetched_models_json IN ({placeholders})",
            (provider_id, *candidates),
        )
        legacy_ids = set(config.LEGACY_PRESET_MODELS.get(provider_id, []))
        if legacy_ids:
            rows = conn.execute(
                "SELECT id, fetched_models_json FROM provider_configs WHERE provider_id = ?",
                (provider_id,),
            ).fetchall()
            for row in rows:
                try:
                    fetched = json.loads(row["fetched_models_json"] or "[]")
                except (ValueError, TypeError):
                    continue
                if (
                    isinstance(fetched, list)
                    and fetched
                    and all(isinstance(m, str) and m in legacy_ids for m in fetched)
                ):
                    conn.execute(
                        "UPDATE provider_configs SET fetched_models_json = '[]' WHERE id = ?",
                        (row["id"],),
                    )


def _ensure_auth_columns(conn: sqlite3.Connection) -> None:
    user_cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "phone" in user_cols:
        email_expr = (
            "COALESCE(NULLIF(email, ''), 'legacy' || id || '@local.invalid')"
            if "email" in user_cols
            else "'legacy' || id || '@local.invalid'"
        )
        password_expr = "COALESCE(password_hash, '')" if "password_hash" in user_cols else "''"
        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("DROP TABLE IF EXISTS users_new")
        conn.execute(
            """CREATE TABLE users_new (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   email TEXT NOT NULL UNIQUE,
                   password_hash TEXT NOT NULL DEFAULT '',
                   nickname TEXT NOT NULL DEFAULT '',
                   created_at TEXT NOT NULL
               )"""
        )
        conn.execute(
            f"""INSERT INTO users_new (id, email, password_hash, nickname, created_at)
                SELECT id, {email_expr}, {password_expr}, nickname, created_at FROM users"""
        )
        conn.execute("DROP TABLE users")
        conn.execute("ALTER TABLE users_new RENAME TO users")
        conn.execute("PRAGMA foreign_keys = ON")
    else:
        _add_column(conn, "users", "password_hash", "TEXT NOT NULL DEFAULT ''")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)")
    conn.execute("DROP TABLE IF EXISTS sms_codes")


def init_db() -> None:
    config.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(get_connection()) as conn:
        conn.executescript(SCHEMA)
        _ensure_card_level_no(conn)
        _ensure_schema_columns(conn)
        _ensure_auth_columns(conn)
        _migrate_legacy_levels(conn)
        _migrate_level_reviews(conn)
        _backfill_levels(conn)
        _clear_legacy_preset_models(conn)
        conn.commit()
