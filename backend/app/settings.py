from contextlib import closing

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends

from . import ai, config
from .auth import get_current_user
from .database import get_connection
from .responses import fail, ok
from .schemas import SettingsUpdate

router = APIRouter(tags=["settings"])


def encrypt_secret(plain: str) -> str:
    return Fernet(config.fernet_key()).encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_secret(encrypted: str) -> str:
    try:
        return Fernet(config.fernet_key()).decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return ""


@router.get("/api/settings")
def get_settings(user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        s = conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (user["id"],)).fetchone()
        data = {
            "email": user["email"],
            "nickname": user["nickname"],
            "daily_card_limit": s["daily_card_limit"] if s else config.DEFAULT_DAILY_LIMIT,
            "ai_provider": s["ai_provider"] if s else "deepseek",
            "ai_base_url": s["ai_base_url"] if s else config.DEEPSEEK_BASE_URL,
            "ai_model": s["ai_model"] if s and s["ai_model"] else "",
            "ai_api_key_configured": False,
            "ai_api_key_masked": "",
        }
        if s and s["ai_api_key_encrypted"]:
            last4 = decrypt_secret(s["ai_api_key_encrypted"])[-4:]
            data["ai_api_key_configured"] = True
            data["ai_api_key_masked"] = f"****{last4}"
        data["providers"] = [
            {
                "id": provider_id,
                "name": provider["name"],
                "base_url": provider["base_url"],
                "model": provider["model"],
            }
            for provider_id, provider in config.AI_PROVIDERS.items()
        ]
        return ok(data)


@router.put("/api/settings")
def update_settings(body: SettingsUpdate, user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        s = conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (user["id"],)).fetchone()
        if s is None:
            conn.execute(
                "INSERT INTO user_settings (user_id, daily_card_limit, ai_provider, ai_base_url, ai_model) VALUES (?, ?, ?, ?, ?)",
                (user["id"], config.DEFAULT_DAILY_LIMIT, "deepseek", config.DEEPSEEK_BASE_URL, ""),
            )
        current = (
            dict(s)
            if s
            else {
                "daily_card_limit": config.DEFAULT_DAILY_LIMIT,
                "ai_provider": "deepseek",
                "ai_base_url": config.DEEPSEEK_BASE_URL,
                "ai_model": "",
                "ai_api_key_encrypted": "",
            }
        )
        nickname = body.nickname.strip() if body.nickname is not None else user["nickname"]
        daily_limit = body.daily_card_limit if body.daily_card_limit is not None else current["daily_card_limit"]
        provider = body.ai_provider or current["ai_provider"]
        preset = config.AI_PROVIDERS.get(provider)
        base_url = body.ai_base_url or (preset["base_url"] if preset and preset["base_url"] else current["ai_base_url"])
        model = current["ai_model"] or ""
        if body.ai_model is not None and body.ai_model.strip():
            model = body.ai_model.strip()
        encrypted = current["ai_api_key_encrypted"]
        if body.ai_api_key is not None and body.ai_api_key.strip():
            encrypted = encrypt_secret(body.ai_api_key.strip())

        conn.execute("UPDATE users SET nickname = ? WHERE id = ?", (nickname, user["id"]))
        conn.execute(
            """UPDATE user_settings
               SET daily_card_limit = ?, ai_provider = ?, ai_base_url = ?, ai_model = ?, ai_api_key_encrypted = ?
               WHERE user_id = ?""",
            (daily_limit, provider, base_url, model, encrypted, user["id"]),
        )
        conn.commit()
    return ok({"saved": True})


@router.post("/api/settings/test-ai")
def test_ai_connection(body: SettingsUpdate | None = None, user: dict = Depends(get_current_user)):
    try:
        result = ai.test_connection(
            user["id"],
            api_key=body.ai_api_key.strip() if body and body.ai_api_key else None,
            base_url=body.ai_base_url.strip() if body and body.ai_base_url else None,
            model=body.ai_model.strip() if body and body.ai_model else None,
        )
    except ai.AIError as exc:
        return fail(4005, str(exc), 400)
    except Exception as exc:  # noqa: BLE001
        return fail(4005, f"连接失败：{exc}", 400)
    return ok(result)


@router.post("/api/settings/reveal-key")
def reveal_api_key(user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        s = conn.execute(
            "SELECT ai_api_key_encrypted FROM user_settings WHERE user_id = ?", (user["id"],)
        ).fetchone()
        api_key = decrypt_secret(s["ai_api_key_encrypted"]) if s and s["ai_api_key_encrypted"] else ""
        return ok({"api_key": api_key})
