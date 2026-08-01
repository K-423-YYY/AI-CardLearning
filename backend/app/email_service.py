import logging
import smtplib
from email.message import EmailMessage

from . import config

logger = logging.getLogger(__name__)


def is_smtp_configured() -> bool:
    return bool(config.SMTP_HOST and config.SMTP_USER and config.SMTP_PASSWORD)


def is_dev_mode() -> bool:
    return not is_smtp_configured() and config.APP_ENV != "prod"


def _send_smtp(to_email: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = config.SMTP_FROM or config.SMTP_USER
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    if config.SMTP_USE_SSL:
        with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as smtp:
            smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
            smtp.send_message(message)
        return

    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as smtp:
        smtp.ehlo()
        if smtp.has_extn("STARTTLS"):
            smtp.starttls()
            smtp.ehlo()
        smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
        smtp.send_message(message)


def send_email_code(email: str, code: str) -> tuple[bool, str]:
    if not is_smtp_configured():
        if config.APP_ENV == "prod":
            logger.error("SMTP 未配置，无法发送验证码")
            return False, "SMTP 未配置"
        logger.info("[开发模式] 邮箱 %s 的验证码：%s（5 分钟内有效）", email, code)
        print(f"[开发模式] 邮箱 {email} 的验证码：{code}（5 分钟内有效）")
        return True, "dev"

    try:
        _send_smtp(
            email,
            "AI闯关学习 登录验证码",
            f"你的验证码是：{code}，5 分钟内有效。如果不是本人操作，请忽略本邮件。",
        )
        return True, "sent"
    except Exception as exc:  # noqa: BLE001
        logger.exception("邮件发送异常")
        return False, str(exc)
