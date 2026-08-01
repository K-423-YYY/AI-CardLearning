import json
from contextlib import closing
from datetime import datetime

from fastapi import APIRouter, Depends

from . import ai, config
from .auth import get_current_user
from .database import get_connection
from .responses import fail, ok
from .schemas import ProviderCreate, ProviderUpdate
from .settings import decrypt_secret, encrypt_secret

router = APIRouter(tags=["providers"])


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _load_json(value: str, default):
    try:
        data = json.loads(value or "[]")
        return data if isinstance(data, list) else default
    except (ValueError, TypeError):
        return default


def _provider_payload(provider) -> dict:
    models = _load_json(provider["models_json"], [])
    return {
        "id": provider["id"],
        "name": provider["name"],
        "provider_id": provider["provider_id"],
        "base_url": provider["base_url"],
        "active": bool(provider["active"]),
        "key_configured": bool(provider["api_key_encrypted"]),
        "models": models,
        "model_count": len(models),
    }


def _ensure_default_provider(conn, user_id: int) -> None:
    count = conn.execute(
        "SELECT COUNT(*) AS cnt FROM provider_configs WHERE user_id = ?", (user_id,)
    ).fetchone()["cnt"]
    if count > 0:
        return
    s = conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()
    provider_id = (s["ai_provider"] if s else "deepseek") or "deepseek"
    preset = config.AI_PROVIDERS.get(provider_id, {})
    base_url = s["ai_base_url"] if s and s["ai_base_url"] else config.DEEPSEEK_BASE_URL
    api_key = decrypt_secret(s["ai_api_key_encrypted"]) if s and s["ai_api_key_encrypted"] else ""
    now = _now()
    conn.execute(
        """INSERT INTO provider_configs
           (user_id, name, provider_id, base_url, api_key_encrypted, active, fetched_models_json, models_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, '[]', ?, ?, ?)""",
        (
            user_id,
            preset.get("name", "DeepSeek"),
            provider_id,
            base_url,
            encrypt_secret(api_key) if api_key else "",
            "[]",
            now,
            now,
        ),
    )
    conn.commit()


@router.get("/api/providers")
def list_providers(user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        _ensure_default_provider(conn, user["id"])
        rows = conn.execute(
            "SELECT * FROM provider_configs WHERE user_id = ? ORDER BY active DESC, id", (user["id"],)
        ).fetchall()
        return ok({"providers": [_provider_payload(row) for row in rows]})


@router.post("/api/providers")
def create_provider(body: ProviderCreate, user: dict = Depends(get_current_user)):
    provider_id = (body.provider_id or "custom").strip() or "custom"
    preset = config.AI_PROVIDERS.get(provider_id, {})
    base_url = (body.base_url or "").strip() or preset.get("base_url", "")
    name = (body.name or "").strip() or preset.get("name") or "自定义服务商"
    if not base_url:
        return fail(4000, "请填写接口地址", 400)
    api_key = (body.api_key or "").strip()
    now = _now()
    with closing(get_connection()) as conn:
        active_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM provider_configs WHERE user_id = ? AND active = 1", (user["id"],)
        ).fetchone()["cnt"]
        active = 1 if active_count == 0 else 0
        cur = conn.execute(
            """INSERT INTO provider_configs
               (user_id, name, provider_id, base_url, api_key_encrypted, active, fetched_models_json, models_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)""",
            (
                user["id"],
                name,
                provider_id,
                base_url,
                encrypt_secret(api_key) if api_key else "",
                active,
                "[]",
                now,
                now,
            ),
        )
        conn.commit()
        return ok({"id": cur.lastrowid, "name": name, "active": bool(active)})


@router.get("/api/providers/{provider_id}")
def provider_detail(provider_id: int, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ? AND user_id = ?", (provider_id, user["id"])
        ).fetchone()
        if row is None:
            return fail(4040, "服务商不存在", 404)
        data = _provider_payload(row)
        data["key_masked"] = (
            f"****{decrypt_secret(row['api_key_encrypted'])[-4:]}"
            if row["api_key_encrypted"]
            else ""
        )
        data["fetched_models"] = _load_json(row["fetched_models_json"], [])
        data["presets"] = [
            {
                "id": pid,
                "name": preset["name"],
                "base_url": preset["base_url"],
                "model": preset["model"],
            }
            for pid, preset in config.AI_PROVIDERS.items()
        ]
        return ok(data)


@router.put("/api/providers/{provider_id}")
def update_provider(provider_id: int, body: ProviderUpdate, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ? AND user_id = ?", (provider_id, user["id"])
        ).fetchone()
        if row is None:
            return fail(4040, "服务商不存在", 404)
        name = (body.name or "").strip() if body.name is not None else row["name"]
        base_url = (body.base_url or "").strip() if body.base_url is not None else row["base_url"]
        if not name:
            name = row["name"]
        if not base_url:
            return fail(4000, "接口地址不能为空", 400)
        encrypted = row["api_key_encrypted"]
        if body.api_key is not None and body.api_key.strip():
            encrypted = encrypt_secret(body.api_key.strip())
        models = row["models_json"]
        if body.models is not None:
            clean = []
            for item in body.models:
                if isinstance(item, dict) and (item.get("name") or item.get("model")):
                    clean.append(
                        {
                            "name": str(item.get("name") or item.get("model") or "").strip(),
                            "model": str(item.get("model") or "").strip(),
                        }
                    )
            models = json.dumps(clean, ensure_ascii=False)
        conn.execute(
            """UPDATE provider_configs
               SET name = ?, base_url = ?, api_key_encrypted = ?, models_json = ?, updated_at = ?
               WHERE id = ? AND user_id = ?""",
            (name, base_url, encrypted, models, _now(), provider_id, user["id"]),
        )
        conn.commit()
        return ok({"saved": True})


@router.delete("/api/providers/{provider_id}")
def delete_provider(provider_id: int, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ? AND user_id = ?", (provider_id, user["id"])
        ).fetchone()
        if row is None:
            return fail(4040, "服务商不存在", 404)
        conn.execute("DELETE FROM provider_configs WHERE id = ? AND user_id = ?", (provider_id, user["id"]))
        if row["active"]:
            conn.execute(
                "UPDATE provider_configs SET active = 1, updated_at = ? WHERE id = (SELECT id FROM provider_configs WHERE user_id = ? ORDER BY id LIMIT 1)",
                (_now(), user["id"]),
            )
        conn.commit()
        return ok({"deleted": True})


@router.post("/api/providers/{provider_id}/activate")
def activate_provider(provider_id: int, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT id FROM provider_configs WHERE id = ? AND user_id = ?", (provider_id, user["id"])
        ).fetchone()
        if row is None:
            return fail(4040, "服务商不存在", 404)
        conn.execute("UPDATE provider_configs SET active = 0 WHERE user_id = ?", (user["id"],))
        conn.execute(
            "UPDATE provider_configs SET active = 1, updated_at = ? WHERE id = ?", (_now(), provider_id)
        )
        conn.commit()
        return ok({"active": True})


@router.post("/api/providers/{provider_id}/fetch-models")
def fetch_models(provider_id: int, connection: str = "direct", user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ? AND user_id = ?", (provider_id, user["id"])
        ).fetchone()
        if row is None:
            return fail(4040, "服务商不存在", 404)
        api_key = decrypt_secret(row["api_key_encrypted"]) if row["api_key_encrypted"] else ""
        base_url = row["base_url"] or config.DEEPSEEK_BASE_URL
    if not api_key:
        return fail(4000, "请先填写并保存 API Key，再获取模型", 400)
    use_proxy = connection == "proxy"
    channel = "代理" if use_proxy else "直连"
    try:
        model_ids = ai.list_models(api_key, base_url, config.MODELS_TIMEOUT_SECONDS, trust_env=use_proxy)
    except Exception as exc:  # noqa: BLE001
        return fail(4005, f"获取模型失败（{channel}）：{exc}", 400)
    if not model_ids:
        return fail(4005, "获取模型失败：官方接口未返回任何模型", 400)
    with closing(get_connection()) as conn:
        conn.execute(
            "UPDATE provider_configs SET fetched_models_json = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (json.dumps(model_ids, ensure_ascii=False), _now(), provider_id, user["id"]),
        )
        conn.commit()
    return ok(
        {
            "count": len(model_ids),
            "models": model_ids,
            "source": "api",
            "channel": channel,
            "note": "成功获取模型",
        }
    )


@router.post("/api/providers/{provider_id}/test")
def test_provider(provider_id: int, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ? AND user_id = ?", (provider_id, user["id"])
        ).fetchone()
        if row is None:
            return fail(4040, "服务商不存在", 404)
        api_key = decrypt_secret(row["api_key_encrypted"]) if row["api_key_encrypted"] else ""
        if not api_key:
            return fail(4000, "请先填写并保存 API Key", 400)
        base_url = row["base_url"] or config.DEEPSEEK_BASE_URL
        models = _load_json(row["models_json"], [])
        if not models or not isinstance(models[0], dict) or not models[0].get("model"):
            return fail(4000, "请先添加并选择模型", 400)
        model = models[0]["model"]
    try:
        result = ai.test_connection(user["id"], api_key=api_key, base_url=base_url, model=model)
    except Exception as exc:  # noqa: BLE001
        return fail(4005, f"连接失败：{exc}", 400)
    return ok(result)


@router.post("/api/providers/{provider_id}/reveal-key")
def reveal_provider_key(provider_id: int, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE id = ? AND user_id = ?", (provider_id, user["id"])
        ).fetchone()
        if row is None:
            return fail(4040, "服务商不存在", 404)
        api_key = decrypt_secret(row["api_key_encrypted"]) if row["api_key_encrypted"] else ""
        return ok({"api_key": api_key})
