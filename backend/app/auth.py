import datetime
import hashlib
import re
import secrets
from contextlib import closing

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from . import config, email_service
from .database import get_connection
from .responses import fail, ok
from .schemas import CodeLoginRequest, LoginRequest, RegisterRequest, ResetPasswordRequest, SendCodeRequest

router = APIRouter(tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ALLOWED_PURPOSES = {"login", "register", "reset"}


def now_str() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _code_hash(code: str) -> str:
    return hashlib.sha256(f"{code}:{config.APP_SECRET_KEY}".encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    iterations = 600_000
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations
    ).hex()
    return f"pbkdf2_sha256${iterations}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt, expected = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)
        ).hex()
        return secrets.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


def _create_jwt(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30),
    }
    return jwt.encode(payload, config.APP_SECRET_KEY, algorithm="HS256")


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"code": 4001, "message": "未登录或登录已过期"},
    )


def get_current_user(request: Request) -> dict:
    token = request.cookies.get(config.COOKIE_NAME)
    if not token:
        raise _unauthorized()
    try:
        payload = jwt.decode(token, config.APP_SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise _unauthorized()
    with closing(get_connection()) as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (payload["sub"],)).fetchone()
    if row is None:
        raise _unauthorized()
    return dict(row)


def _public_user(row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "nickname": row["nickname"],
        "created_at": row["created_at"],
    }


def _login_response(user: dict) -> Response:
    token = _create_jwt(user["id"])
    result = ok({"user": _public_user(user)})
    result.set_cookie(
        config.COOKIE_NAME,
        token,
        max_age=30 * 24 * 3600,
        httponly=True,
        secure=config.APP_ENV == "prod",
        samesite="lax",
        path="/",
    )
    return result


def _validate_email(email: str) -> bool:
    return bool(email) and len(email) <= 254 and EMAIL_RE.match(email) is not None


def _create_user(conn, email: str, password_hash: str = "") -> dict:
    cur = conn.execute(
        "INSERT INTO users (email, password_hash, nickname, created_at) VALUES (?, ?, ?, ?)",
        (email, password_hash, f"用户{email.split('@')[0][:12]}", now_str()),
    )
    user_id = cur.lastrowid
    conn.execute(
        "INSERT INTO user_settings (user_id, daily_card_limit, ai_provider, ai_base_url, ai_model) VALUES (?, ?, ?, ?, ?)",
        (user_id, config.DEFAULT_DAILY_LIMIT, "deepseek", config.DEEPSEEK_BASE_URL, ""),
    )
    return dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def _verify_code(email: str, purpose: str, code: str):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT * FROM email_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1",
            (email, purpose),
        ).fetchone()
        if row is None:
            return fail(4002, "请先获取验证码", 400)
        if row["attempts"] >= config.MAX_VERIFY_ATTEMPTS:
            return fail(4002, "验证码尝试次数过多，请重新获取", 400)

        expires_at = datetime.datetime.fromisoformat(row["expires_at"])
        if datetime.datetime.now() > expires_at:
            return fail(4002, "验证码已过期，请重新获取", 400)

        if not secrets.compare_digest(row["code_hash"], _code_hash(code)):
            conn.execute("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?", (row["id"],))
            conn.commit()
            return fail(4002, "验证码错误", 400)

        conn.execute("DELETE FROM email_codes WHERE email = ? AND purpose = ?", (email, purpose))
        conn.commit()
    return None


@router.post("/api/auth/send-code")
def send_code(body: SendCodeRequest):
    email = normalize_email(body.email)
    if not _validate_email(email):
        return fail(4000, "邮箱格式不正确", 400)
    purpose = (body.purpose or "login").strip().lower()
    if purpose not in ALLOWED_PURPOSES:
        return fail(4000, "验证码用途不正确", 400)

    now = datetime.datetime.now()
    with closing(get_connection()) as conn:
        latest = conn.execute(
            "SELECT sent_at FROM email_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1",
            (email, purpose),
        ).fetchone()
        if latest is not None:
            sent_at = datetime.datetime.fromisoformat(latest["sent_at"])
            if (now - sent_at).total_seconds() < config.SEND_INTERVAL_SECONDS:
                return fail(4003, "请 60 秒后再发送验证码", 429)

        day_start = now.strftime("%Y-%m-%d 00:00:00")
        sent_today = conn.execute(
            "SELECT COUNT(*) AS cnt FROM email_codes WHERE email = ? AND sent_at >= ?",
            (email, day_start),
        ).fetchone()["cnt"]
        if sent_today >= config.EMAIL_CODE_LIMIT:
            return fail(4003, "今日验证码发送次数已达上限", 429)

        code = f"{secrets.randbelow(1000000):06d}"
        conn.execute("DELETE FROM email_codes WHERE email = ? AND purpose = ?", (email, purpose))
        conn.execute(
            "INSERT INTO email_codes (email, code_hash, expires_at, attempts, sent_at, purpose) VALUES (?, ?, ?, 0, ?, ?)",
            (
                email,
                _code_hash(code),
                (now + datetime.timedelta(seconds=config.VERIFY_CODE_TTL_SECONDS)).strftime("%Y-%m-%d %H:%M:%S"),
                now_str(),
                purpose,
            ),
        )
        conn.commit()

    sent, detail = email_service.send_email_code(email, code)
    if not sent:
        return fail(5000, f"邮件发送失败：{detail}", 500)

    data = {"expires_in": config.VERIFY_CODE_TTL_SECONDS}
    if email_service.is_dev_mode():
        data["dev_code"] = code
    return ok(data, "验证码已发送")


@router.post("/api/auth/login-code")
def login_code(body: CodeLoginRequest):
    email = normalize_email(body.email)
    if not _validate_email(email):
        return fail(4000, "邮箱格式不正确", 400)
    check = _verify_code(email, "login", body.code)
    if check is not None:
        return check

    with closing(get_connection()) as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user is None:
            user = _create_user(conn, email)
        conn.commit()
    return _login_response(user)


@router.post("/api/auth/register")
def register(body: RegisterRequest):
    email = normalize_email(body.email)
    if not _validate_email(email):
        return fail(4000, "邮箱格式不正确", 400)

    with closing(get_connection()) as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
    if exists:
        return fail(4002, "该邮箱已注册，请直接登录", 400)

    check = _verify_code(email, "register", body.code)
    if check is not None:
        return check

    with closing(get_connection()) as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
        if exists:
            return fail(4002, "该邮箱已注册，请直接登录", 400)
        user = _create_user(conn, email, password_hash=hash_password(body.password))
        conn.commit()
    return ok({"user": _public_user(user)}, "注册成功")


@router.post("/api/auth/login")
def login(body: LoginRequest):
    email = normalize_email(body.email)
    if not _validate_email(email):
        return fail(4000, "邮箱格式不正确", 400)

    with closing(get_connection()) as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None or not user["password_hash"] or not verify_password(body.password, user["password_hash"]):
        return fail(4002, "邮箱或密码不正确", 400)
    return _login_response(user)


@router.post("/api/auth/reset-password")
def reset_password(body: ResetPasswordRequest):
    email = normalize_email(body.email)
    if not _validate_email(email):
        return fail(4000, "邮箱格式不正确", 400)

    with closing(get_connection()) as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None:
        return fail(4002, "该邮箱尚未注册", 400)

    check = _verify_code(email, "reset", body.code)
    if check is not None:
        return check

    with closing(get_connection()) as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(body.password), user["id"]),
        )
        conn.commit()
    return ok(message="密码已重置，请用新密码登录")


@router.post("/api/auth/logout")
def logout():
    result = ok(message="已退出登录")
    result.delete_cookie(config.COOKIE_NAME, path="/")
    return result


@router.get("/api/me")
def me(user: dict = Depends(get_current_user)):
    with closing(get_connection()) as conn:
        s = conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (user["id"],)).fetchone()
        zone_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM learning_zones WHERE user_id = ?", (user["id"],)
        ).fetchone()["cnt"]
        settings = {
            "daily_card_limit": s["daily_card_limit"] if s else config.DEFAULT_DAILY_LIMIT,
            "ai_provider": s["ai_provider"] if s else "deepseek",
            "ai_api_key_configured": bool(s and s["ai_api_key_encrypted"]),
        }
        return ok({"user": _public_user(user), "settings": settings, "zone_count": zone_count})
