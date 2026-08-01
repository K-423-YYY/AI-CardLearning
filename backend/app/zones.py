import io
import math
from contextlib import closing
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile

from . import ai, config
from .auth import get_current_user
from .database import get_connection
from .responses import fail, ok
from .schemas import GenerateRequest, LevelLayoutRequest, ZoneCreate, ZoneSettingsUpdate

router = APIRouter(tags=["zones"])

STATUS_DONE = "成功"
STATUS_LEVEL_DONE = "已通关"
STATUS_LEVEL_TODO = "待闯关"
LEVEL_TYPE_NEW = "新学"
LEVEL_TYPE_REVIEW = "复习"
ROLE_NEW = "新学"
ROLE_REVIEW = "复习"
SORT_EASY = "easy_to_hard"
SORT_BLOCK = "block"
DIFFICULTY_ORDER = {"易": 0, "中": 1, "难": 2}

# AI 复习关聚簇参数：一个复习关尽量凑到 target 张卡，日期间隔超过 max_gap 天就断开。
REVIEW_CLUSTER_TARGET = 15
REVIEW_CLUSTER_MAX_GAP = 3


def _owned_zone(conn, zone_id: int, user_id: int):
    return conn.execute(
        "SELECT * FROM learning_zones WHERE id = ? AND user_id = ?", (zone_id, user_id)
    ).fetchone()


def _zone_stats(conn, zone_id: int) -> dict:
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN c.status = '成功' THEN 1 ELSE 0 END) AS success_count
           FROM cards c JOIN files f ON f.id = c.file_id
           WHERE f.zone_id = ?""",
        (zone_id,),
    ).fetchone()
    return {"total": row["total"], "success": row["success_count"] or 0}


def _zone_daily_limit(conn, zone_id: int, user_id: int) -> int:
    row = conn.execute("SELECT daily_limit FROM zone_settings WHERE zone_id = ?", (zone_id,)).fetchone()
    if row is not None:
        return row["daily_limit"]
    s = conn.execute("SELECT daily_card_limit FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()
    return s["daily_card_limit"] if s else config.DEFAULT_DAILY_LIMIT


def _zone_level_limit(conn, zone_id: int) -> int:
    row = conn.execute("SELECT daily_limit FROM zone_settings WHERE zone_id = ?", (zone_id,)).fetchone()
    return row["daily_limit"] if row is not None else config.DEFAULT_DAILY_LIMIT


def _zone_sort_mode(conn, zone_id: int) -> str:
    row = conn.execute("SELECT sort_mode FROM zone_settings WHERE zone_id = ?", (zone_id,)).fetchone()
    if row and row["sort_mode"] in (SORT_EASY, SORT_BLOCK):
        return row["sort_mode"]
    return SORT_EASY


def _zone_created_date(conn, zone_id: int) -> date:
    row = conn.execute("SELECT created_at FROM learning_zones WHERE id = ?", (zone_id,)).fetchone()
    if row is None:
        return date.today()
    try:
        return datetime.strptime(row["created_at"][:10], "%Y-%m-%d").date()
    except ValueError:
        return date.today()


def _zone_total_cards(conn, zone_id: int) -> int:
    row = conn.execute(
        """SELECT COUNT(*) AS cnt FROM cards c JOIN files f ON f.id = c.file_id
           WHERE f.zone_id = ?""",
        (zone_id,),
    ).fetchone()
    return row["cnt"] if row else 0


def _pending_new_cards(conn, zone_id: int) -> list[int]:
    sort_mode = _zone_sort_mode(conn, zone_id)
    if sort_mode == SORT_BLOCK:
        order_sql = (
            "c.block_name, "
            "CASE c.difficulty WHEN '易' THEN 0 WHEN '中' THEN 1 WHEN '难' THEN 2 ELSE 1 END, "
            "c.sort_order, c.id"
        )
    else:
        order_sql = (
            "CASE c.difficulty WHEN '易' THEN 0 WHEN '中' THEN 1 WHEN '难' THEN 2 ELSE 1 END, "
            "c.sort_order, c.id"
        )
    rows = conn.execute(
        f"""SELECT c.id FROM cards c JOIN files f ON f.id = c.file_id
            WHERE f.zone_id = ? AND c.status != ? ORDER BY {order_sql}""",
        (zone_id, STATUS_DONE),
    ).fetchall()
    return [row["id"] for row in rows]


def _review_events(conn, zone_id: int, user_id: int) -> list[tuple[int, int]]:
    """生成“卡片 -> 计划复习天”候选：新卡按遗忘曲线模拟，已学卡用真实排期。"""
    new_count = max(1, _zone_level_limit(conn, zone_id))
    pending = _pending_new_cards(conn, zone_id)
    events: list[tuple[int, int]] = []
    for idx, card_id in enumerate(pending):
        day_no = idx // new_count + 1
        for interval in config.REVIEW_INTERVALS:
            events.append((card_id, day_no + interval))
    start = _zone_created_date(conn, zone_id)
    rows = conn.execute(
        """SELECT card_id, review_date FROM review_schedule
           WHERE user_id = ? AND zone_id = ? AND status = 'pending'""",
        (user_id, zone_id),
    ).fetchall()
    for row in rows:
        try:
            d = datetime.strptime(row["review_date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        day_no = max(1, (d - start).days + 1)
        events.append((row["card_id"], day_no))
    return events


def _cluster_review_events(events: list[tuple[int, int]]) -> list[dict]:
    counts: dict[int, set[int]] = {}
    for card_id, day_no in events:
        counts.setdefault(day_no, set()).add(card_id)
    days = sorted(counts)
    clusters: list[dict] = []
    i = 0
    while i < len(days):
        start_day = days[i]
        cards: set[int] = set()
        last_day = start_day
        while i < len(days):
            d = days[i]
            if cards and d - start_day > REVIEW_CLUSTER_MAX_GAP:
                break
            cards.update(counts[d])
            last_day = d
            i += 1
            if len(cards) >= REVIEW_CLUSTER_TARGET:
                break
        clusters.append(
            {
                "day_no": start_day,
                "card_ids": sorted(cards),
                "days": list(range(start_day, last_day + 1)),
            }
        )
    return clusters


def _day_review_clusters(events: list[tuple[int, int]]) -> list[dict]:
    counts: dict[int, set[int]] = {}
    for card_id, day_no in events:
        counts.setdefault(day_no, set()).add(card_id)
    return [
        {"day_no": day_no, "card_ids": sorted(card_ids), "days": [day_no]}
        for day_no, card_ids in sorted(counts.items())
    ]


def _merge_review_clusters(clusters: list[dict], target: int) -> list[dict]:
    if target <= 0:
        return []
    while len(clusters) > target:
        if len(clusters) <= 1:
            break
        best_idx = 0
        best_size = None
        for i in range(len(clusters) - 1):
            merged = set(clusters[i]["card_ids"]) | set(clusters[i + 1]["card_ids"])
            if best_size is None or len(merged) < best_size:
                best_size = len(merged)
                best_idx = i
        left, right = clusters[best_idx], clusters[best_idx + 1]
        clusters[best_idx : best_idx + 2] = [
            {
                "day_no": min(left["day_no"], right["day_no"]),
                "card_ids": sorted(set(left["card_ids"]) | set(right["card_ids"])),
                "days": sorted(set(left["days"]) | set(right["days"])),
            }
        ]
    return clusters


def compute_level_bounds(conn, zone_id: int, user_id: int) -> dict:
    """返回关卡数量下限 L、AI 上限 U 和推荐值，L = ceil(总卡片数 ÷ 每日新卡数)。"""
    total = _zone_total_cards(conn, zone_id)
    new_count = max(1, _zone_level_limit(conn, zone_id))
    if total == 0:
        return {"lower": 0, "upper": 0, "recommended": 0, "new_count": new_count}
    pending = _pending_new_cards(conn, zone_id)
    new_level_count = math.ceil(len(pending) / new_count) if pending else 0
    events = _review_events(conn, zone_id, user_id)
    clusters = _cluster_review_events(events)
    day_clusters = _day_review_clusters(events)
    strong = sum(1 for c in clusters if len(c["card_ids"]) >= 4)
    lower = max(1, math.ceil(total / new_count))
    max_possible = new_level_count + len(day_clusters)
    if max_possible < lower:
        lower = max(1, max_possible)
    upper = max(lower, new_level_count + len(clusters), new_level_count + len(day_clusters))
    review_hint = 1 if clusters else 0
    recommended = min(upper, max(lower, new_level_count + max(strong, review_hint)))
    return {
        "lower": lower,
        "upper": upper,
        "recommended": recommended,
        "new_count": new_count,
    }


def _build_level_specs(conn, zone_id: int, user_id: int, level_count: int) -> list[dict]:
    new_count = max(1, _zone_level_limit(conn, zone_id))
    pending = _pending_new_cards(conn, zone_id)
    new_level_count = math.ceil(len(pending) / new_count) if pending else 0
    if level_count < new_level_count:
        raise ValueError("关卡数不能少于新学关下限")

    specs: list[dict] = []
    sort_mode = _zone_sort_mode(conn, zone_id)
    for lv in range(1, new_level_count + 1):
        new_ids = pending[(lv - 1) * new_count : lv * new_count]
        name = ""
        if sort_mode == SORT_BLOCK and new_ids:
            placeholders = ",".join("?" * len(new_ids))
            row = conn.execute(
                f"SELECT block_name FROM cards WHERE id IN ({placeholders}) AND block_name != '' ORDER BY id LIMIT 1",
                new_ids,
            ).fetchone()
            name = row["block_name"] if row else ""
        specs.append(
            {
                "level_no": lv,
                "level_type": LEVEL_TYPE_NEW,
                "name": name,
                "day_no": lv,
                "new_count": len(new_ids),
                "new_card_ids": new_ids,
                "card_ids": new_ids,
            }
        )

    review_count = max(0, level_count - new_level_count)
    events = _review_events(conn, zone_id, user_id)
    clusters = _cluster_review_events(events)
    if review_count < len(clusters):
        clusters = _merge_review_clusters(clusters, review_count)
    elif review_count > len(clusters):
        day_clusters = _day_review_clusters(events)
        if len(day_clusters) < review_count:
            review_count = len(day_clusters)
        clusters = _merge_review_clusters(day_clusters, review_count)
    for offset, cluster in enumerate(clusters, start=new_level_count + 1):
        specs.append(
            {
                "level_no": offset,
                "level_type": LEVEL_TYPE_REVIEW,
                "name": "",
                "day_no": cluster["day_no"],
                "new_count": 0,
                "new_card_ids": [],
                "card_ids": cluster["card_ids"],
            }
        )
    return specs


def _build_new_level_specs(conn, zone_id: int, pending: list[int], start_level_no: int = 1) -> list[dict]:
    new_count = max(1, _zone_level_limit(conn, zone_id))
    sort_mode = _zone_sort_mode(conn, zone_id)
    specs: list[dict] = []
    for offset in range(0, len(pending), new_count):
        ids = pending[offset : offset + new_count]
        name = ""
        if sort_mode == SORT_BLOCK and ids:
            placeholders = ",".join("?" * len(ids))
            row = conn.execute(
                f"""SELECT block_name FROM cards
                    WHERE id IN ({placeholders}) AND block_name != '' ORDER BY sort_order, id LIMIT 1""",
                ids,
            ).fetchone()
            name = row["block_name"] if row else ""
        level_no = start_level_no + len(specs)
        specs.append(
            {
                "level_no": level_no,
                "level_type": LEVEL_TYPE_NEW,
                "name": name,
                "day_no": level_no,
                "new_count": len(ids),
                "new_card_ids": ids,
                "card_ids": ids,
            }
        )
    return specs


def delete_cards(conn, zone_id: int, card_ids: list[int]) -> int:
    """删除卡片并清理关卡映射、当日任务、复习排期和答题记录。"""
    if not card_ids:
        return 0
    placeholders = ",".join("?" * len(card_ids))
    rows = conn.execute(
        f"""SELECT c.id FROM cards c JOIN files f ON f.id = c.file_id
            WHERE f.zone_id = ? AND c.id IN ({placeholders})""",
        [zone_id, *card_ids],
    ).fetchall()
    ids = [row["id"] for row in rows]
    if not ids:
        return 0
    ph = ",".join("?" * len(ids))
    for table in ("level_cards", "daily_tasks", "review_schedule", "learning_records"):
        conn.execute(f"DELETE FROM {table} WHERE card_id IN ({ph})", ids)
    conn.execute(f"DELETE FROM cards WHERE id IN ({ph})", ids)
    return len(ids)


def rebuild_zone_levels(
    conn,
    zone_id: int,
    user_id: int | None = None,
    level_count: int | None = None,
    preserve_completed: bool = False,
) -> int:
    """按新学/复习混合排版重建关卡：新卡固定按每日数量推进，其余关卡为纯复习关。"""
    if user_id is None:
        row = conn.execute("SELECT user_id FROM learning_zones WHERE id = ?", (zone_id,)).fetchone()
        user_id = row["user_id"] if row else 0
    pending = _pending_new_cards(conn, zone_id)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    preserved: list[dict] = []
    if preserve_completed:
        done_levels = conn.execute(
            "SELECT * FROM levels WHERE zone_id = ? AND status = ? ORDER BY level_no",
            (zone_id, STATUS_LEVEL_DONE),
        ).fetchall()
        for lv in done_levels:
            lc_rows = conn.execute(
                "SELECT card_id, role FROM level_cards WHERE zone_id = ? AND level_no = ?",
                (zone_id, lv["level_no"]),
            ).fetchall()
            if not lc_rows:
                continue
            new_ids = [r["card_id"] for r in lc_rows if r["role"] == ROLE_NEW]
            review_ids = [r["card_id"] for r in lc_rows if r["role"] == ROLE_REVIEW]
            card_ids = list(dict.fromkeys(new_ids + review_ids))
            preserved.append(
                {
                    "level_type": lv["level_type"],
                    "name": lv["name"],
                    "day_no": lv["day_no"],
                    "new_count": lv["new_count"],
                    "new_card_ids": new_ids,
                    "card_ids": card_ids,
                    "status": STATUS_LEVEL_DONE,
                    "completed_at": lv["completed_at"],
                }
            )
        preserved_ids = {cid for spec in preserved for cid in spec["card_ids"]}
        remaining_pending = [cid for cid in pending if cid not in preserved_ids]
        new_specs = _build_new_level_specs(conn, zone_id, remaining_pending, len(preserved) + 1)
        events = _review_events(conn, zone_id, user_id)
        clusters = _cluster_review_events(events)
        review_specs = [
            {
                "level_no": len(preserved) + len(new_specs) + 1 + idx,
                "level_type": LEVEL_TYPE_REVIEW,
                "name": "",
                "day_no": cluster["day_no"],
                "new_count": 0,
                "new_card_ids": [],
                "card_ids": cluster["card_ids"],
            }
            for idx, cluster in enumerate(clusters)
        ]
        specs = preserved + new_specs + review_specs
    else:
        bounds = compute_level_bounds(conn, zone_id, user_id)
        if level_count is None:
            row = conn.execute("SELECT level_count FROM zone_settings WHERE zone_id = ?", (zone_id,)).fetchone()
            level_count = row["level_count"] if row and row["level_count"] else bounds["recommended"]
        if bounds["upper"] > 0:
            level_count = max(bounds["lower"], min(bounds["upper"], level_count or bounds["lower"]))
        if level_count <= 0:
            return 0
        specs = _build_level_specs(conn, zone_id, user_id, level_count)

    for idx, spec in enumerate(specs, start=1):
        spec["level_no"] = idx
    conn.execute("DELETE FROM level_cards WHERE zone_id = ?", (zone_id,))
    conn.execute("DELETE FROM levels WHERE zone_id = ?", (zone_id,))

    for spec in specs:
        status = spec.get("status", STATUS_LEVEL_TODO)
        completed_at = spec.get("completed_at")
        conn.execute(
            """INSERT INTO levels (zone_id, level_no, name, level_type, day_no, new_count, daily_limit, status, completed_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                zone_id,
                spec["level_no"],
                spec.get("name", ""),
                spec["level_type"],
                spec["day_no"],
                spec["new_count"],
                _zone_level_limit(conn, zone_id),
                status,
                completed_at,
                now,
            ),
        )
        for card_id in spec["card_ids"]:
            role = ROLE_NEW if card_id in spec["new_card_ids"] else ROLE_REVIEW
            conn.execute(
                """INSERT OR IGNORE INTO level_cards (zone_id, level_no, card_id, role, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (zone_id, spec["level_no"], card_id, role, now),
            )
        if spec["new_card_ids"]:
            placeholders = ",".join("?" * len(spec["new_card_ids"]))
            conn.execute(
                f"UPDATE cards SET level_no = ? WHERE id IN ({placeholders})",
                [spec["level_no"], *spec["new_card_ids"]],
            )

    conn.execute(
        """INSERT INTO zone_settings (zone_id, daily_limit, level_count, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(zone_id) DO UPDATE SET level_count = excluded.level_count, updated_at = excluded.updated_at""",
        (zone_id, _zone_level_limit(conn, zone_id), len(specs), now),
    )
    return len(specs)


def _decode_text(raw: bytes) -> str:
    for encoding in ("utf-8", "gb18030", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return ""


@router.get("/api/zones")
def list_zones(user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        rows = conn.execute(
            """SELECT z.id, z.name, z.status, z.created_at, z.updated_at,
                      COALESCE((SELECT zs.daily_limit FROM zone_settings zs WHERE zs.zone_id = z.id),
                               (SELECT us.daily_card_limit FROM user_settings us WHERE us.user_id = z.user_id),
                               5) AS daily_limit,
                      (SELECT COUNT(*) FROM cards c JOIN files f ON f.id = c.file_id WHERE f.zone_id = z.id) AS card_count,
                      (SELECT COUNT(*) FROM cards c JOIN files f ON f.id = c.file_id WHERE f.zone_id = z.id AND c.status = '成功') AS success_count
               FROM learning_zones z
               WHERE z.user_id = ?
               ORDER BY z.updated_at DESC, z.id DESC""",
            (user["id"],),
        ).fetchall()
        return ok({"zones": [dict(r) for r in rows]})


@router.post("/api/zones")
def create_zone(body: ZoneCreate, user: dict = Depends(get_current_user)):
    name = (body.name or "").strip() or f"学习区 {datetime.now().strftime('%m月%d日')}"
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with closing(get_connection()) as conn:
        cur = conn.execute(
            "INSERT INTO learning_zones (user_id, name, status, created_at, updated_at) VALUES (?, ?, '进行中', ?, ?)",
            (user["id"], name, now, now),
        )
        conn.commit()
        return ok({"id": cur.lastrowid, "name": name, "status": "进行中"})


@router.get("/api/zones/{zone_id}")
def zone_detail(zone_id: int, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        zone = _owned_zone(conn, zone_id, user["id"])
        if zone is None:
            return fail(4040, "学习区不存在", 404)
        stats = _zone_stats(conn, zone_id)
        files = conn.execute(
            "SELECT id, filename, created_at, length(content) AS size FROM files WHERE zone_id = ? ORDER BY id",
            (zone_id,),
        ).fetchall()
        data = dict(zone)
        data["daily_limit"] = _zone_daily_limit(conn, zone_id, user["id"])
        data["sort_mode"] = _zone_sort_mode(conn, zone_id)
        data["level_count"] = conn.execute(
            "SELECT COUNT(*) AS cnt FROM levels WHERE zone_id = ?", (zone_id,)
        ).fetchone()["cnt"]
        data["completed_levels"] = conn.execute(
            "SELECT COUNT(*) AS cnt FROM levels WHERE zone_id = ? AND status = ?",
            (zone_id, STATUS_LEVEL_DONE),
        ).fetchone()["cnt"]
        return ok({"zone": data, "stats": stats, "files": [dict(f) for f in files]})


@router.put("/api/zones/{zone_id}/settings")
def update_zone_settings(zone_id: int, body: ZoneSettingsUpdate, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        row = conn.execute("SELECT * FROM zone_settings WHERE zone_id = ?", (zone_id,)).fetchone()
        daily_limit = (
            body.daily_card_limit
            if body.daily_card_limit is not None
            else (row["daily_limit"] if row else _zone_daily_limit(conn, zone_id, user["id"]))
        )
        sort_mode = body.sort_mode if body.sort_mode is not None else (row["sort_mode"] if row else SORT_EASY)
        if sort_mode not in (SORT_EASY, SORT_BLOCK):
            return fail(4007, "排序模式仅支持 easy_to_hard 或 block", 400)
        conn.execute(
            """INSERT INTO zone_settings (zone_id, daily_limit, sort_mode, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(zone_id) DO UPDATE SET daily_limit = excluded.daily_limit, sort_mode = excluded.sort_mode, updated_at = excluded.updated_at""",
            (zone_id, daily_limit, sort_mode, now),
        )
        # 按确认方案：改每日卡数只刷新上下限；切换排序模式才触发完整重排。
        if body.sort_mode is not None:
            rebuild_zone_levels(conn, zone_id, user_id=user["id"])
        conn.commit()
        return ok(
            {
                "zone_id": zone_id,
                "daily_card_limit": daily_limit,
                "sort_mode": sort_mode,
            }
        )


@router.put("/api/zones/{zone_id}/levels/layout")
def relayout_zone_levels(zone_id: int, body: LevelLayoutRequest, user: dict = Depends(get_current_user)):
    """用户在 L..U 范围内选择关卡数 N，重新生成新学 + 复习关排版。"""
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
        bounds = compute_level_bounds(conn, zone_id, user["id"])
        if bounds["upper"] == 0:
            return fail(4007, "还没有卡片，无法排版", 400)
        if body.level_count < bounds["lower"] or body.level_count > bounds["upper"]:
            return fail(4007, f"关卡数需在 {bounds['lower']} 到 {bounds['upper']} 之间", 400)
        rebuild_zone_levels(conn, zone_id, user_id=user["id"], level_count=body.level_count)
        conn.commit()
        return ok({"zone_id": zone_id, "level_count": body.level_count})


@router.post("/api/zones/{zone_id}/files")
def upload_file(zone_id: int, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        zone = _owned_zone(conn, zone_id, user["id"])
        if zone is None:
            return fail(4040, "学习区不存在", 404)

        filename = file.filename or "unnamed.txt"
        ext = Path(filename).suffix.lower()
        if ext not in config.ALLOWED_EXTENSIONS:
            return fail(
                4006,
                f"不支持的文件类型：{ext or '未知'}，仅支持 {', '.join(sorted(config.ALLOWED_EXTENSIONS))}",
                400,
            )

        raw = file.file.read()
        if len(raw) > config.MAX_FILE_SIZE:
            return fail(4006, "文件不能超过 5MB", 400)

        if ext == ".pdf":
            try:
                from pypdf import PdfReader

                reader = PdfReader(io.BytesIO(raw))
                content = "\n".join(page.extract_text() or "" for page in reader.pages)
            except Exception:  # noqa: BLE001
                return fail(4006, "PDF 解析失败，请上传可复制文本的 PDF", 400)
        else:
            content = _decode_text(raw)

        content = content.strip()
        if not content:
            return fail(4006, "文件中没有可读取的文本内容", 400)

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cur = conn.execute(
            "INSERT INTO files (zone_id, filename, content, created_at) VALUES (?, ?, ?, ?)",
            (zone_id, filename, content, now),
        )
        conn.execute("UPDATE learning_zones SET updated_at = ? WHERE id = ?", (now, zone_id))
        conn.commit()
        return ok({"id": cur.lastrowid, "filename": filename, "size": len(content)})


@router.post("/api/zones/{zone_id}/analyze")
def analyze_zone(zone_id: int, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
    try:
        points = ai.analyze_zone(user["id"], zone_id)
    except ai.AIError as exc:
        return fail(4004 if "API Key" in str(exc) else 4005, str(exc), 400)
    return ok({"knowledge_points": points})


@router.post("/api/zones/{zone_id}/generate")
def generate_cards(zone_id: int, body: GenerateRequest, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
        replace_old = body.replace_old or "none"
        if replace_old not in ("none", "all", "selected"):
            return fail(4007, "replace_old 仅支持 none / all / selected", 400)
        if replace_old == "all":
            rows = conn.execute(
                """SELECT c.id FROM cards c JOIN files f ON f.id = c.file_id
                   WHERE f.zone_id = ?""",
                (zone_id,),
            ).fetchall()
            delete_cards(conn, zone_id, [row["id"] for row in rows])
        elif replace_old == "selected":
            delete_cards(conn, zone_id, body.delete_card_ids or [])
        conn.commit()
    try:
        points = body.blocks if body.blocks is not None else (body.knowledge_points or [])
        result = ai.generate_cards(user["id"], zone_id, points)
    except ai.AIError as exc:
        return fail(4004 if "API Key" in str(exc) else 4005, str(exc), 400)
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is not None:
            rebuild_zone_levels(conn, zone_id, user_id=user["id"], preserve_completed=True)
            conn.commit()
    return ok(result)


@router.get("/api/zones/{zone_id}/cards")
def list_cards(zone_id: int, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        if _owned_zone(conn, zone_id, user["id"]) is None:
            return fail(4040, "学习区不存在", 404)
        rows = conn.execute(
            """SELECT c.id, c.title, c.question, c.answer, c.explanation, c.label, c.block_name, c.difficulty, c.sort_order, c.status, c.wrong_count, c.created_at, f.filename
               FROM cards c JOIN files f ON f.id = c.file_id
               WHERE f.zone_id = ?
               ORDER BY c.sort_order, c.id""",
            (zone_id,),
        ).fetchall()
        return ok({"cards": [dict(r) for r in rows]})
