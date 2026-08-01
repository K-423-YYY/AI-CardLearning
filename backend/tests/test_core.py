import os
import sys
import tempfile
from contextlib import closing
from datetime import date, datetime, timedelta
from itertools import count
from pathlib import Path
from types import SimpleNamespace

TMP_DIR = tempfile.mkdtemp(prefix="learn_backend_test_")
os.environ["APP_ENV"] = "test"
os.environ["APP_SECRET_KEY"] = "test-secret-key-for-tests-0123456789abcdef"
os.environ["DATABASE_PATH"] = str(Path(TMP_DIR) / "test.db")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.database import get_connection  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)

email_counter = count(1)


def next_email() -> str:
    return f"user{email_counter.__next__()}@test.local"


def login(email: str | None = None) -> dict:
    email = email or next_email()
    resp = client.post("/api/auth/send-code", json={"email": email, "purpose": "login"})
    assert resp.status_code == 200
    code = resp.json()["data"]["dev_code"]
    resp = client.post("/api/auth/login-code", json={"email": email, "code": code})
    assert resp.status_code == 200
    return resp.json()["data"]["user"]


def create_zone(name: str = "测试学习区") -> int:
    resp = client.post("/api/zones", json={"name": name})
    assert resp.status_code == 200
    return resp.json()["data"]["id"]


def upload_file(zone_id: int) -> int:
    resp = client.post(
        f"/api/zones/{zone_id}/files",
        files={"file": ("note.txt", "Python 基础内容\n函数与类", "text/plain")},
    )
    assert resp.status_code == 200
    return resp.json()["data"]["id"]


def first_file_id(zone_id: int) -> int:
    resp = client.get(f"/api/zones/{zone_id}")
    return resp.json()["data"]["files"][0]["id"]


def insert_card(zone_id: int, title: str, answer: str = "A") -> int:
    upload_file(zone_id)
    with closing(get_connection()) as conn:
        cur = conn.execute(
            """INSERT INTO cards (file_id, title, question, option_a, option_b, option_c, option_d, answer, explanation, label, status, wrong_count, created_at)
               VALUES (?, ?, ?, 'A选项', 'B选项', 'C选项', 'D选项', ?, '解析', '常考', '待学', 0, ?)""",
            (first_file_id(zone_id), title, title + "题干", answer, datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
        return cur.lastrowid


def test_dev_login_flow():
    user = login()
    assert user["email"].endswith("@test.local")
    resp = client.get("/api/me")
    assert resp.status_code == 200
    assert resp.json()["code"] == 0
    assert resp.json()["data"]["settings"]["daily_card_limit"] == 5


def test_send_code_rate_limit():
    email = next_email()
    resp = client.post("/api/auth/send-code", json={"email": email})
    assert resp.status_code == 200
    resp = client.post("/api/auth/send-code", json={"email": email})
    assert resp.status_code == 429
    assert resp.json()["code"] == 4003


def test_register_password_login_flow():
    email = next_email()
    resp = client.post("/api/auth/send-code", json={"email": email, "purpose": "register"})
    assert resp.status_code == 200
    code = resp.json()["data"]["dev_code"]

    resp = client.post(
        "/api/auth/register",
        json={"email": email, "code": code, "password": "secret123"},
    )
    assert resp.status_code == 200

    resp = client.post("/api/auth/login", json={"email": email, "password": "wrong123"})
    assert resp.status_code == 400
    resp = client.post("/api/auth/login", json={"email": email, "password": "secret123"})
    assert resp.status_code == 200
    assert resp.json()["data"]["user"]["email"] == email


def test_reset_password_flow():
    email = next_email()
    resp = client.post("/api/auth/send-code", json={"email": email, "purpose": "register"})
    code = resp.json()["data"]["dev_code"]
    client.post(
        "/api/auth/register",
        json={"email": email, "code": code, "password": "oldpass123"},
    )

    resp = client.post("/api/auth/send-code", json={"email": email, "purpose": "reset"})
    assert resp.status_code == 200
    code = resp.json()["data"]["dev_code"]
    resp = client.post(
        "/api/auth/reset-password",
        json={"email": email, "code": code, "password": "newpass123"},
    )
    assert resp.status_code == 200

    resp = client.post("/api/auth/login", json={"email": email, "password": "newpass123"})
    assert resp.status_code == 200


def test_zone_create_and_upload():
    login()
    zone_id = create_zone()
    file_id = upload_file(zone_id)
    resp = client.get(f"/api/zones/{zone_id}")
    assert resp.status_code == 200
    assert [f["id"] for f in resp.json()["data"]["files"]] == [file_id]


def test_today_queue_and_correct_answer():
    login()
    zone_id = create_zone()
    insert_card(zone_id, "知识点一")
    insert_card(zone_id, "知识点二")
    resp = client.get(f"/api/zones/{zone_id}/today")
    data = resp.json()["data"]
    assert data["daily_limit"] == 5
    assert len(data["pending"]) == 2

    first = data["pending"][0]
    resp = client.post(f"/api/cards/{first['card_id']}/answer", json={"option": first["answer"]})
    assert resp.status_code == 200
    assert resp.json()["data"]["correct"] is True

    resp = client.get(f"/api/zones/{zone_id}/today")
    assert len(resp.json()["data"]["pending"]) == 1


def test_wrong_three_times_marks_review():
    login()
    zone_id = create_zone()
    insert_card(zone_id, "错题卡", answer="A")

    for _ in range(3):
        resp = client.get(f"/api/zones/{zone_id}/today")
        card = resp.json()["data"]["pending"][0]
        wrong_option = "B" if card["answer"] != "B" else "C"
        resp = client.post(f"/api/cards/{card['card_id']}/answer", json={"option": wrong_option})
        assert resp.json()["data"]["correct"] is False

    with closing(get_connection()) as conn:
        row = conn.execute("SELECT status FROM cards WHERE id = ?", (card["card_id"],)).fetchone()
        assert row["status"] == "重点复习"

    resp = client.get(f"/api/zones/{zone_id}/today")
    data = resp.json()["data"]
    assert data["completed"] is False
    assert len(data["pending"]) == 1
    assert data["pending"][0]["card_id"] == card["card_id"]


def test_skipped_tasks_reopen_same_day():
    user = login()
    zone_id = create_zone()
    card_id = insert_card(zone_id, "跳过任务卡")
    resp = client.get(f"/api/zones/{zone_id}/today")
    assert len(resp.json()["data"]["pending"]) == 1

    with closing(get_connection()) as conn:
        conn.execute(
            """UPDATE daily_tasks SET status = 'skipped'
               WHERE user_id = ? AND zone_id = ? AND card_id = ? AND task_date = ?""",
            (user["id"], zone_id, card_id, date.today().isoformat()),
        )
        conn.commit()

    resp = client.get(f"/api/zones/{zone_id}/today")
    data = resp.json()["data"]
    assert data["completed"] is False
    assert any(c["card_id"] == card_id for c in data["pending"])


def test_same_day_can_continue_to_next_level():
    login()
    zone_id = create_zone()
    client.put(f"/api/zones/{zone_id}/settings", json={"daily_card_limit": 2})
    for i in range(4):
        insert_card(zone_id, f"卡片{i + 1}")

    for _ in range(2):
        resp = client.get(f"/api/zones/{zone_id}/today")
        card = resp.json()["data"]["pending"][0]
        resp = client.post(f"/api/cards/{card['card_id']}/answer", json={"option": card["answer"]})
        assert resp.json()["data"]["correct"] is True

    resp = client.get(f"/api/zones/{zone_id}/today")
    data = resp.json()["data"]
    assert data["completed"] is False
    assert len(data["pending"]) == 2
    assert data["done_count"] == 2
    assert data["total_count"] == 4

    for _ in range(2):
        resp = client.get(f"/api/zones/{zone_id}/today")
        card = resp.json()["data"]["pending"][0]
        resp = client.post(f"/api/cards/{card['card_id']}/answer", json={"option": card["answer"]})
        assert resp.json()["data"]["correct"] is True

    resp = client.get(f"/api/zones/{zone_id}/today")
    data = resp.json()["data"]
    assert data["completed"] is True
    assert data["pending"] == []


def test_settings_encrypts_api_key():
    login()
    resp = client.put("/api/settings", json={"ai_api_key": "sk-abcdefgh1234", "daily_card_limit": 8})
    assert resp.status_code == 200
    resp = client.get("/api/settings")
    data = resp.json()["data"]
    assert data["daily_card_limit"] == 8
    assert data["ai_api_key_configured"] is True
    assert data["ai_api_key_masked"] == "****1234"

    user = client.get("/api/me").json()["data"]["user"]
    with closing(get_connection()) as conn:
        stored = conn.execute(
            "SELECT ai_api_key_encrypted FROM user_settings WHERE user_id = ?", (user["id"],)
        ).fetchone()["ai_api_key_encrypted"]
    assert "sk-abcdefgh1234" not in stored
    assert stored != ""


def test_settings_providers_and_test_ai(monkeypatch):
    login()
    resp = client.get("/api/settings")
    data = resp.json()["data"]
    provider_ids = {p["id"] for p in data["providers"]}
    assert {
        "deepseek",
        "openai",
        "kimi",
        "qwen",
        "zhipu",
        "siliconflow",
        "custom",
    } <= provider_ids

    client.put("/api/settings", json={"ai_api_key": "sk-test-key", "ai_model": "deepseek-chat"})

    class FakeCompletions:
        def create(self, **kwargs):
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="OK"))])

    class FakeOpenAI:
        def __init__(self, *args, **kwargs):
            pass

        @property
        def chat(self):
            return SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr("app.ai.OpenAI", FakeOpenAI)
    resp = client.post("/api/settings/test-ai")
    assert resp.status_code == 200
    result = resp.json()["data"]
    assert result["ok"] is True
    assert result["reply"] == "OK"


def test_upload_rejects_unsupported_type():
    login()
    zone_id = create_zone()
    resp = client.post(
        f"/api/zones/{zone_id}/files",
        files={"file": ("bad.exe", b"MZ...", "application/octet-stream")},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == 4006


def test_zone_daily_limit_setting():
    login()
    zone_id = create_zone()
    resp = client.put(f"/api/zones/{zone_id}/settings", json={"daily_card_limit": 2})
    assert resp.status_code == 200
    resp = client.get(f"/api/zones/{zone_id}")
    assert resp.json()["data"]["zone"]["daily_limit"] == 2

    insert_card(zone_id, "卡片一")
    insert_card(zone_id, "卡片二")
    insert_card(zone_id, "卡片三")
    resp = client.get(f"/api/zones/{zone_id}/today")
    assert len(resp.json()["data"]["pending"]) == 2
    resp = client.get(f"/api/zones/{zone_id}/progress")
    assert resp.json()["data"]["daily_limit"] == 2


def test_wrong_collection_and_practice():
    login()
    zone_id = create_zone()
    card_id = insert_card(zone_id, "错题集卡片")
    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    wrong_letter = "B" if card["answer"] != "B" else "C"
    resp = client.post(f"/api/cards/{card_id}/answer", json={"option": wrong_letter})
    assert resp.json()["data"]["correct"] is False

    resp = client.get(f"/api/zones/{zone_id}/wrong-cards")
    wrong_cards = resp.json()["data"]["wrong_cards"]
    assert len(wrong_cards) == 1
    assert wrong_cards[0]["wrong_times"] == 1

    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    resp = client.post(f"/api/cards/{card_id}/answer", json={"option": card["answer"]})
    assert resp.json()["data"]["correct"] is True

    resp = client.post(f"/api/zones/{zone_id}/wrong-practice")
    assert resp.json()["data"]["added"] == 1
    resp = client.get(f"/api/zones/{zone_id}/today")
    assert any(c["card_id"] == card_id for c in resp.json()["data"]["pending"])


def test_wrong_practice_standalone_mode():
    login()
    zone_id = create_zone()
    card_id = insert_card(zone_id, "错题单独复习卡")
    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    wrong_letter = "B" if card["answer"] != "B" else "C"
    resp = client.post(f"/api/cards/{card_id}/answer", json={"option": wrong_letter})
    assert resp.json()["data"]["correct"] is False

    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    resp = client.post(f"/api/cards/{card_id}/answer", json={"option": card["answer"]})
    assert resp.json()["data"]["correct"] is True

    resp = client.get(f"/api/zones/{zone_id}/wrong-practice")
    data = resp.json()["data"]
    assert len(data["cards"]) == 1
    practice = data["cards"][0]
    assert practice["card_id"] == card_id

    wrong_letter = "B" if practice["answer"] != "B" else "C"
    resp = client.post(
        f"/api/cards/{card_id}/answer",
        json={"option": wrong_letter, "mode": "wrong"},
    )
    assert resp.json()["data"]["correct"] is False
    assert resp.json()["data"]["next_options"] is not None
    next_answer = resp.json()["data"]["next_answer"]

    resp = client.post(
        f"/api/cards/{card_id}/answer",
        json={"option": next_answer, "mode": "wrong"},
    )
    assert resp.json()["data"]["correct"] is True


def test_level_review_schedule_and_checkin(monkeypatch):
    user = login()
    zone_id = create_zone()
    card_id = insert_card(zone_id, "复习卡")

    resp = client.get(f"/api/zones/{zone_id}/progress")
    assert resp.json()["data"]["checked_today"] is False

    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    resp = client.post(f"/api/cards/{card_id}/answer", json={"option": card["answer"]})
    assert resp.json()["data"]["correct"] is True

    with closing(get_connection()) as conn:
        rows = conn.execute(
            "SELECT review_date FROM review_schedule WHERE user_id = ? AND zone_id = ?",
            (user["id"], zone_id),
        ).fetchall()
    review_dates = sorted(r["review_date"] for r in rows)
    today = date.today()
    expected = sorted((today + timedelta(days=i)).isoformat() for i in (1, 2, 4, 7, 15))
    assert review_dates == expected

    resp = client.get(f"/api/zones/{zone_id}/progress")
    progress = resp.json()["data"]
    assert progress["checked_today"] is True
    assert progress["today_done"] is True
    assert progress["streak"] >= 1
    assert progress["completed_levels"] == 1
    assert progress["levels"][0]["status"] == "已通关"

    class FakeDate(date):
        @classmethod
        def today(cls):
            return date.today() + timedelta(days=1)

    monkeypatch.setattr("app.cards.date", FakeDate)
    resp = client.get(f"/api/zones/{zone_id}/today")
    pending = resp.json()["data"]["pending"]
    assert any(c["card_id"] == card_id for c in pending)


def test_level_layout_bounds_and_relayout():
    login()
    zone_id = create_zone()
    client.put(f"/api/zones/{zone_id}/settings", json={"daily_card_limit": 5})
    for i in range(20):
        insert_card(zone_id, f"知识点{i + 1}")

    resp = client.get(f"/api/zones/{zone_id}/progress")
    layout = resp.json()["data"]["layout"]
    assert layout["lower"] == 4
    assert layout["upper"] >= 4
    assert layout["lower"] <= layout["recommended"] <= layout["upper"]

    resp = client.put(f"/api/zones/{zone_id}/levels/layout", json={"level_count": 7})
    assert resp.status_code == 200
    data = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    assert data["total_levels"] == 7
    assert data["new_levels"] == 4
    assert data["review_levels"] == 3
    assert [lv["level_type"] for lv in data["levels"]] == ["新学"] * 4 + ["复习"] * 3

    resp = client.put(f"/api/zones/{zone_id}/levels/layout", json={"level_count": 3})
    assert resp.status_code == 400
    assert resp.json()["code"] == 4007


def test_level_replay_does_not_affect_progress():
    user = login()
    zone_id = create_zone()
    card_id = insert_card(zone_id, "重开卡")
    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    client.post(f"/api/cards/{card_id}/answer", json={"option": card["answer"]})

    with closing(get_connection()) as conn:
        schedule_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM review_schedule WHERE user_id = ? AND zone_id = ?",
            (user["id"], zone_id),
        ).fetchone()["cnt"]

    resp = client.get(f"/api/zones/{zone_id}/levels/1/start")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["mode"] == "replay"
    assert len(data["cards"]) == 1
    replay_card = data["cards"][0]
    resp = client.post(
        f"/api/cards/{card_id}/answer",
        json={"option": replay_card["answer"], "mode": "replay", "level_no": 1},
    )
    assert resp.json()["data"]["correct"] is True

    with closing(get_connection()) as conn:
        status = conn.execute("SELECT status FROM cards WHERE id = ?", (card_id,)).fetchone()["status"]
        new_schedule_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM review_schedule WHERE user_id = ? AND zone_id = ?",
            (user["id"], zone_id),
        ).fetchone()["cnt"]
    assert status == "成功"
    assert new_schedule_count == schedule_count


def test_daily_limit_changes_bounds_without_reset():
    login()
    zone_id = create_zone()
    for i in range(6):
        insert_card(zone_id, f"卡{i + 1}")

    for _ in range(5):
        resp = client.get(f"/api/zones/{zone_id}/today")
        card = resp.json()["data"]["pending"][0]
        client.post(f"/api/cards/{card['card_id']}/answer", json={"option": card["answer"]})

    before = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    assert before["completed_levels"] == 1
    total_levels_before = before["total_levels"]

    resp = client.put(f"/api/zones/{zone_id}/settings", json={"daily_card_limit": 2})
    assert resp.status_code == 200
    after = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    assert after["daily_limit"] == 2
    assert after["layout"]["lower"] == 3
    assert after["total_levels"] == total_levels_before
    assert after["completed_levels"] == 1


def test_relayout_resets_levels_but_keeps_card_status_and_reviews():
    user = login()
    zone_id = create_zone()
    card_ids = [insert_card(zone_id, f"卡{i + 1}") for i in range(6)]
    for _ in range(5):
        resp = client.get(f"/api/zones/{zone_id}/today")
        card = resp.json()["data"]["pending"][0]
        client.post(f"/api/cards/{card['card_id']}/answer", json={"option": card["answer"]})

    before = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    layout = before["layout"]
    target = max(layout["lower"], min(layout["upper"], layout["recommended"]))
    with closing(get_connection()) as conn:
        schedule_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM review_schedule WHERE user_id = ? AND zone_id = ?",
            (user["id"], zone_id),
        ).fetchone()["cnt"]

    resp = client.put(f"/api/zones/{zone_id}/levels/layout", json={"level_count": target})
    assert resp.status_code == 200
    after = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    assert after["completed_levels"] == 0
    assert all(lv["status"] == "待闯关" for lv in after["levels"])

    with closing(get_connection()) as conn:
        done_ids = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM cards WHERE id IN (%s) AND status = '成功'" % ",".join("?" * len(card_ids)),
                card_ids,
            ).fetchall()
        ]
        new_role_ids = [
            r["card_id"]
            for r in conn.execute(
                "SELECT card_id FROM level_cards WHERE zone_id = ? AND role = '新学'", (zone_id,)
            ).fetchall()
        ]
        new_schedule_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM review_schedule WHERE user_id = ? AND zone_id = ?",
            (user["id"], zone_id),
        ).fetchone()["cnt"]
    assert len(done_ids) == 5
    assert not (set(done_ids) & set(new_role_ids))
    assert new_schedule_count == schedule_count


def test_block_sort_mode_groups_levels_by_block():
    login()
    zone_id = create_zone()
    card_ids = [insert_card(zone_id, f"知识点{i + 1}") for i in range(6)]
    blocks = {
        card_ids[0]: ("区块A", "易", 1),
        card_ids[1]: ("区块A", "易", 2),
        card_ids[2]: ("区块B", "中", 3),
        card_ids[3]: ("区块B", "中", 4),
        card_ids[4]: ("区块A", "难", 5),
        card_ids[5]: ("区块A", "难", 6),
    }
    with closing(get_connection()) as conn:
        for cid, (block, difficulty, order) in blocks.items():
            conn.execute(
                "UPDATE cards SET block_name = ?, difficulty = ?, sort_order = ? WHERE id = ?",
                (block, difficulty, order, cid),
            )
        conn.commit()

    resp = client.put(f"/api/zones/{zone_id}/settings", json={"sort_mode": "block"})
    assert resp.status_code == 200
    data = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    assert data["sort_mode"] == "block"
    new_levels = [lv for lv in data["levels"] if lv["level_type"] == "新学"]
    assert new_levels[0]["name"] == "区块A"
    assert new_levels[0]["block_name"] == "区块A"
    assert new_levels[1]["name"] == "区块B"

    client.put(f"/api/zones/{zone_id}/settings", json={"sort_mode": "easy_to_hard"})
    data = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    assert data["sort_mode"] == "easy_to_hard"
    assert data["levels"][0]["name"] == ""


def test_generate_replace_all_deletes_old_cards(monkeypatch):
    login()
    zone_id = create_zone()
    insert_card(zone_id, "旧卡一")
    insert_card(zone_id, "旧卡二")
    client.put("/api/settings", json={"ai_api_key": "sk-test-key", "ai_model": "deepseek-chat"})

    def fake_chat_json(api_key, base_url, model, messages, timeout=90):
        if "生成一道选择题" in messages[-1]["content"]:
            return {
                "question": "新题干",
                "options": ["A", "B", "C", "D"],
                "answer": "A",
                "explanation": "解析",
                "label": "常考",
            }
        return {
            "blocks": [
                {"name": "新区块", "points": [{"title": "新知识点", "description": "描述", "difficulty": "中"}]}
            ]
        }

    monkeypatch.setattr("app.ai._chat_json", fake_chat_json)
    resp = client.post(
        f"/api/zones/{zone_id}/generate",
        json={
            "blocks": [{"name": "新区块", "points": [{"title": "新知识点", "description": "描述", "difficulty": "中"}]}],
            "replace_old": "all",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["generated"] == 1
    cards = client.get(f"/api/zones/{zone_id}/cards").json()["data"]["cards"]
    assert len(cards) == 1
    assert cards[0]["title"] == "新知识点"


def test_generate_replace_selected_deletes_only_selected(monkeypatch):
    login()
    zone_id = create_zone()
    old_ids = [insert_card(zone_id, f"旧卡{i}") for i in range(3)]
    client.put("/api/settings", json={"ai_api_key": "sk-test-key", "ai_model": "deepseek-chat"})

    def fake_chat_json(api_key, base_url, model, messages, timeout=90):
        if "生成一道选择题" in messages[-1]["content"]:
            return {
                "question": "新题干",
                "options": ["A", "B", "C", "D"],
                "answer": "A",
                "explanation": "解析",
                "label": "常考",
            }
        return {
            "blocks": [
                {"name": "新区块", "points": [{"title": "新知识点", "description": "描述", "difficulty": "中"}]}
            ]
        }

    monkeypatch.setattr("app.ai._chat_json", fake_chat_json)
    resp = client.post(
        f"/api/zones/{zone_id}/generate",
        json={
            "blocks": [{"name": "新区块", "points": [{"title": "新知识点", "description": "描述", "difficulty": "中"}]}],
            "replace_old": "selected",
            "delete_card_ids": [old_ids[0]],
        },
    )
    assert resp.status_code == 200
    cards = client.get(f"/api/zones/{zone_id}/cards").json()["data"]["cards"]
    card_titles = [c["title"] for c in cards]
    assert "旧卡0" not in card_titles
    assert "旧卡1" in card_titles
    assert "旧卡2" in card_titles
    assert "新知识点" in card_titles


def test_batch_delete_preserves_completed_levels_and_removes_empty():
    login()
    zone_id = create_zone()
    client.put(f"/api/zones/{zone_id}/settings", json={"daily_card_limit": 2})
    card_ids = [insert_card(zone_id, f"卡{i + 1}") for i in range(4)]

    for _ in range(2):
        resp = client.get(f"/api/zones/{zone_id}/today")
        card = resp.json()["data"]["pending"][0]
        client.post(f"/api/cards/{card['card_id']}/answer", json={"option": card["answer"]})

    before = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    assert before["completed_levels"] == 1

    resp = client.post("/api/cards/batch-delete", json={"card_ids": [card_ids[0]]})
    assert resp.status_code == 200
    after = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    assert after["completed_levels"] == 1

    resp = client.post("/api/cards/batch-delete", json={"card_ids": [card_ids[1]]})
    assert resp.status_code == 200
    after = client.get(f"/api/zones/{zone_id}/progress").json()["data"]
    assert after["completed_levels"] == 0

    with closing(get_connection()) as conn:
        for table, column in (
            ("cards", "id"),
            ("level_cards", "card_id"),
            ("daily_tasks", "card_id"),
            ("review_schedule", "card_id"),
            ("learning_records", "card_id"),
        ):
            cnt = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM {table} WHERE {column} IN (?, ?)",
                (card_ids[0], card_ids[1]),
            ).fetchone()["cnt"]
            assert cnt == 0, table


def test_batch_review_adds_to_today_queue():
    login()
    zone_id = create_zone()
    card_id = insert_card(zone_id, "加入复习卡")
    resp = client.post("/api/cards/batch-review", json={"card_ids": [card_id]})
    assert resp.json()["data"]["added"] == 1

    resp = client.get(f"/api/zones/{zone_id}/today")
    pending = resp.json()["data"]["pending"]
    assert any(c["card_id"] == card_id for c in pending)
    review_card = next(c for c in pending if c["card_id"] == card_id)
    client.post(f"/api/cards/{card_id}/answer", json={"option": review_card["answer"]})
    with closing(get_connection()) as conn:
        status = conn.execute("SELECT status FROM cards WHERE id = ?", (card_id,)).fetchone()["status"]
    assert status == "成功"


def test_wrong_review_reschedules_from_one_day(monkeypatch):
    user = login()
    zone_id = create_zone()
    card_id = insert_card(zone_id, "错后重排卡")
    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    client.post(f"/api/cards/{card_id}/answer", json={"option": card["answer"]})

    class FakeDate(date):
        @classmethod
        def today(cls):
            return date.today() + timedelta(days=1)

    monkeypatch.setattr("app.cards.date", FakeDate)
    monkeypatch.setattr(
        "app.cards.datetime",
        type(
            "FakeDateTime1",
            (datetime,),
            {"now": classmethod(lambda cls, tz=None: datetime.now(tz) + timedelta(days=1))},
        ),
    )

    resp = client.get(f"/api/zones/{zone_id}/today")
    review_card = next(c for c in resp.json()["data"]["pending"] if c["card_id"] == card_id)
    wrong = "B" if review_card["answer"] != "B" else "C"
    client.post(f"/api/cards/{card_id}/answer", json={"option": wrong})

    tomorrow = (date.today() + timedelta(days=2)).isoformat()
    with closing(get_connection()) as conn:
        pending_dates = [
            r["review_date"]
            for r in conn.execute(
                "SELECT review_date FROM review_schedule WHERE user_id = ? AND zone_id = ? AND status = 'pending'",
                (user["id"], zone_id),
            ).fetchall()
        ]
    assert pending_dates == [tomorrow]

    class FakeDate2(date):
        @classmethod
        def today(cls):
            return date.today() + timedelta(days=2)

    monkeypatch.setattr("app.cards.date", FakeDate2)
    monkeypatch.setattr(
        "app.cards.datetime",
        type(
            "FakeDateTime2",
            (datetime,),
            {"now": classmethod(lambda cls, tz=None: datetime.now(tz) + timedelta(days=2))},
        ),
    )

    resp = client.get(f"/api/zones/{zone_id}/today")
    review_card = next(c for c in resp.json()["data"]["pending"] if c["card_id"] == card_id)
    client.post(f"/api/cards/{card_id}/answer", json={"option": review_card["answer"]})

    base = date.today() + timedelta(days=2)
    expected = sorted((base + timedelta(days=i)).isoformat() for i in (1, 2, 4, 7, 15))
    with closing(get_connection()) as conn:
        pending_dates = sorted(
            r["review_date"]
            for r in conn.execute(
                "SELECT review_date FROM review_schedule WHERE user_id = ? AND zone_id = ? AND status = 'pending'",
                (user["id"], zone_id),
            ).fetchall()
        )
    assert pending_dates == expected


def test_levels_grouped_by_daily_limit():
    login()
    zone_id = create_zone()
    client.put(f"/api/zones/{zone_id}/settings", json={"daily_card_limit": 3})
    for i in range(7):
        insert_card(zone_id, f"卡片{i + 1}")

    resp = client.get(f"/api/zones/{zone_id}/progress")
    data = resp.json()["data"]
    assert data["daily_limit"] == 3
    assert data["new_levels"] == 3
    assert data["layout"]["lower"] == 3
    assert data["total_levels"] >= 3
    assert data["current_level"] == 1
    assert [lv["card_count"] for lv in data["levels"] if lv["level_type"] == "新学"] == [3, 3, 1]

    resp = client.get(f"/api/zones/{zone_id}/today")
    assert len(resp.json()["data"]["pending"]) == 3


def test_level_regroup_after_daily_limit_change():
    login()
    zone_id = create_zone()
    client.put(f"/api/zones/{zone_id}/settings", json={"daily_card_limit": 2})
    for i in range(4):
        insert_card(zone_id, f"卡{i + 1}")
    client.put(f"/api/zones/{zone_id}/settings", json={"daily_card_limit": 3})

    resp = client.get(f"/api/zones/{zone_id}/progress")
    data = resp.json()["data"]
    assert data["new_levels"] == 2
    assert [lv["card_count"] for lv in data["levels"] if lv["level_type"] == "新学"] == [3, 1]


def test_level_advance_and_due_review(monkeypatch):
    login()
    zone_id = create_zone()
    client.put(f"/api/zones/{zone_id}/settings", json={"daily_card_limit": 2})
    insert_card(zone_id, "卡1")
    insert_card(zone_id, "卡2")
    insert_card(zone_id, "卡3")

    for _ in range(2):
        resp = client.get(f"/api/zones/{zone_id}/today")
        card = resp.json()["data"]["pending"][0]
        resp = client.post(f"/api/cards/{card['card_id']}/answer", json={"option": card["answer"]})
        assert resp.json()["data"]["correct"] is True

    resp = client.get(f"/api/zones/{zone_id}/progress")
    data = resp.json()["data"]
    assert data["current_level"] == 2
    assert data["completed_levels"] == 1
    assert data["checked_today"] is True

    class FakeDate(date):
        @classmethod
        def today(cls):
            return date.today() + timedelta(days=1)

    monkeypatch.setattr("app.cards.date", FakeDate)
    resp = client.get(f"/api/zones/{zone_id}/today")
    pending = resp.json()["data"]["pending"]
    assert len(pending) == 3


def test_review_card_stays_due_after_review_mark(monkeypatch):
    user = login()
    zone_id = create_zone()
    card_id = insert_card(zone_id, "复习错题卡")
    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    resp = client.post(f"/api/cards/{card_id}/answer", json={"option": card["answer"]})
    assert resp.json()["data"]["correct"] is True

    class FakeDate(date):
        @classmethod
        def today(cls):
            return date.today() + timedelta(days=1)

    monkeypatch.setattr("app.cards.date", FakeDate)

    class FakeDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(tz) + timedelta(days=1)

    monkeypatch.setattr("app.cards.datetime", FakeDateTime)
    for _ in range(3):
        resp = client.get(f"/api/zones/{zone_id}/today")
        pending = resp.json()["data"]["pending"]
        assert any(c["card_id"] == card_id for c in pending)
        review_card = next(c for c in pending if c["card_id"] == card_id)
        wrong = "B" if review_card["answer"] != "B" else "C"
        client.post(f"/api/cards/{card_id}/answer", json={"option": wrong})

    with closing(get_connection()) as conn:
        status = conn.execute("SELECT status FROM cards WHERE id = ?", (card_id,)).fetchone()["status"]
    assert status == "重点复习"

    class FakeDate2(date):
        @classmethod
        def today(cls):
            return date.today() + timedelta(days=2)

    monkeypatch.setattr("app.cards.date", FakeDate2)
    monkeypatch.setattr(
        "app.cards.datetime",
        type(
            "FakeDateTime2",
            (datetime,),
            {"now": classmethod(lambda cls, tz=None: datetime.now(tz) + timedelta(days=2))},
        ),
    )
    resp = client.get(f"/api/zones/{zone_id}/today")
    assert any(c["card_id"] == card_id for c in resp.json()["data"]["pending"])


def test_ai_analyze_and_generate_with_mock(monkeypatch):
    login()
    zone_id = create_zone()
    upload_file(zone_id)
    client.put("/api/settings", json={"ai_api_key": "sk-test-key", "ai_model": "deepseek-chat"})

    def fake_chat_json(api_key, base_url, model, messages, timeout=90):
        content = messages[-1]["content"]
        if "生成一道选择题" in content:
            return {
                "question": "下面哪个是题干",
                "options": ["选项A", "选项B", "选项C", "选项D"],
                "answer": "A",
                "explanation": "解析内容",
                "label": "必考",
            }
        return {"knowledge_points": [{"title": "知识点一", "description": "描述一"}]}

    monkeypatch.setattr("app.ai._chat_json", fake_chat_json)

    resp = client.post(f"/api/zones/{zone_id}/analyze")
    assert resp.status_code == 200
    points = resp.json()["data"]["knowledge_points"]
    assert [p["title"] for p in points] == ["知识点一"]

    resp = client.post(f"/api/zones/{zone_id}/generate", json={"knowledge_points": ["知识点一"]})
    assert resp.status_code == 200
    assert resp.json()["data"]["generated"] == 1

    resp = client.post(f"/api/zones/{zone_id}/generate", json={"knowledge_points": ["知识点一"]})
    assert resp.status_code == 200
    assert resp.json()["data"]["generated"] == 0

    resp = client.get(f"/api/zones/{zone_id}/cards")
    cards = resp.json()["data"]["cards"]
    assert len(cards) == 1
    assert cards[0]["answer"] == "A"


def test_ai_analyze_blocks_and_generate_with_mock(monkeypatch):
    login()
    zone_id = create_zone()
    upload_file(zone_id)
    client.put("/api/settings", json={"ai_api_key": "sk-test-key", "ai_model": "deepseek-chat"})

    def fake_chat_json(api_key, base_url, model, messages, timeout=90):
        content = messages[-1]["content"]
        if "生成一道选择题" in content:
            return {
                "question": "题干",
                "options": ["选项A", "选项B", "选项C", "选项D"],
                "answer": "A",
                "explanation": "解析",
                "label": "必考",
            }
        return {
            "blocks": [
                {
                    "name": "基础区块",
                    "points": [
                        {"title": "知识点一", "description": "描述一", "difficulty": "易"},
                        {"title": "知识点二", "description": "描述二", "difficulty": "难"},
                    ],
                }
            ]
        }

    monkeypatch.setattr("app.ai._chat_json", fake_chat_json)
    resp = client.post(f"/api/zones/{zone_id}/analyze")
    points = resp.json()["data"]["knowledge_points"]
    assert len(points) == 2
    assert points[0]["block_name"] == "基础区块"
    assert points[0]["difficulty"] == "易"

    resp = client.post(
        f"/api/zones/{zone_id}/generate",
        json={"blocks": [{"name": "基础区块", "points": points}]},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["generated"] == 2

    cards = client.get(f"/api/zones/{zone_id}/cards").json()["data"]["cards"]
    assert all(c["block_name"] == "基础区块" for c in cards)
    assert {c["difficulty"] for c in cards} == {"易", "难"}


def test_zone_completes_when_all_cards_done():
    login()
    zone_id = create_zone()
    insert_card(zone_id, "唯一知识点")
    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    resp = client.post(f"/api/cards/{card['card_id']}/answer", json={"option": card["answer"]})
    assert resp.json()["data"]["correct"] is True

    resp = client.get(f"/api/zones/{zone_id}")
    assert resp.json()["data"]["zone"]["status"] == "已完成"


def test_duplicate_answer_is_rejected():
    login()
    zone_id = create_zone()
    insert_card(zone_id, "重复提交卡")
    resp = client.get(f"/api/zones/{zone_id}/today")
    card = resp.json()["data"]["pending"][0]
    resp = client.post(f"/api/cards/{card['card_id']}/answer", json={"option": card["answer"]})
    assert resp.json()["data"]["correct"] is True

    resp = client.post(f"/api/cards/{card['card_id']}/answer", json={"option": card["answer"]})
    assert resp.status_code == 409
    assert resp.json()["code"] == 4090


def test_provider_config_and_single_active():
    login()
    client.put("/api/settings", json={"ai_api_key": "sk-legacy-key", "ai_model": "deepseek-chat"})
    resp = client.get("/api/providers")
    providers = resp.json()["data"]["providers"]
    assert len(providers) == 1
    first = providers[0]
    assert first["active"] is True
    assert first["key_configured"] is True

    resp = client.post(
        "/api/providers",
        json={"provider_id": "openai", "name": "我的 OpenAI", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
    )
    assert resp.status_code == 200
    second_id = resp.json()["data"]["id"]
    resp = client.get("/api/providers")
    active = [p for p in resp.json()["data"]["providers"] if p["active"]]
    assert len(active) == 1 and active[0]["id"] == first["id"]

    resp = client.post(f"/api/providers/{second_id}/activate")
    assert resp.status_code == 200
    resp = client.get("/api/providers")
    active = [p for p in resp.json()["data"]["providers"] if p["active"]]
    assert len(active) == 1 and active[0]["id"] == second_id


def test_provider_reveal_key_and_model_rows():
    login()
    client.put("/api/settings", json={"ai_api_key": "sk-visible-key-1234"})
    resp = client.get("/api/providers")
    pid = resp.json()["data"]["providers"][0]["id"]

    resp = client.post(f"/api/providers/{pid}/reveal-key")
    assert resp.status_code == 200
    assert resp.json()["data"]["api_key"] == "sk-visible-key-1234"

    resp = client.put(
        f"/api/providers/{pid}",
        json={"models": [{"name": "我的模型", "model": "deepseek-chat"}]},
    )
    assert resp.status_code == 200
    resp = client.get(f"/api/providers/{pid}")
    assert resp.json()["data"]["models"] == [{"name": "我的模型", "model": "deepseek-chat"}]


def test_fetch_models_uses_provider(monkeypatch):
    login()
    client.put("/api/settings", json={"ai_api_key": "sk-test-key"})
    resp = client.get("/api/providers")
    pid = resp.json()["data"]["providers"][0]["id"]

    monkeypatch.setattr(
        "app.providers.ai.list_models",
        lambda *a, **k: ["deepseek-chat", "deepseek-reasoner"],
    )
    resp = client.post(f"/api/providers/{pid}/fetch-models")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["count"] == 2
    assert data["models"] == ["deepseek-chat", "deepseek-reasoner"]
    assert data["source"] == "api"
    assert data["channel"] == "直连"


def test_fetch_models_can_use_proxy(monkeypatch):
    login()
    client.put("/api/settings", json={"ai_api_key": "sk-test-key"})
    resp = client.get("/api/providers")
    pid = resp.json()["data"]["providers"][0]["id"]

    calls = []

    def fake_list_models(*args, **kwargs):
        calls.append(kwargs)
        return ["deepseek-chat"]

    monkeypatch.setattr("app.providers.ai.list_models", fake_list_models)
    resp = client.post(f"/api/providers/{pid}/fetch-models?connection=proxy")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["channel"] == "代理"
    assert calls[0]["trust_env"] is True


def test_fetch_models_requires_api_key():
    login()
    resp = client.get("/api/providers")
    pid = resp.json()["data"]["providers"][0]["id"]

    resp = client.post(f"/api/providers/{pid}/fetch-models")
    assert resp.status_code == 400
    assert resp.json()["code"] == 4000
    assert "API Key" in resp.json()["message"]


def test_fetch_models_errors_when_live_api_fails(monkeypatch):
    login()
    client.put("/api/settings", json={"ai_api_key": "sk-test-key"})
    resp = client.get("/api/providers")
    pid = resp.json()["data"]["providers"][0]["id"]

    def boom(*args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr("app.providers.ai.list_models", boom)
    resp = client.post(f"/api/providers/{pid}/fetch-models")
    assert resp.status_code == 400
    assert resp.json()["code"] == 4005
    assert "获取模型失败" in resp.json()["message"]


def test_create_provider_has_no_preset_models():
    login()
    resp = client.post(
        "/api/providers",
        json={"provider_id": "openai", "name": "我的 OpenAI", "base_url": "https://api.openai.com/v1"},
    )
    assert resp.status_code == 200
    pid = resp.json()["data"]["id"]
    detail = client.get(f"/api/providers/{pid}").json()["data"]
    assert detail["models"] == []


def test_logout_clears_session():
    login()
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 200
    resp = client.get("/api/me")
    assert resp.status_code == 401
