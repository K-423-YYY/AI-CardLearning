import base64
import hashlib
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

APP_ENV = os.getenv("APP_ENV", "dev")
APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", "dev-secret-key-change-me")
APP_PORT = int(os.getenv("APP_PORT", "8000"))

raw_db_path = os.getenv("DATABASE_PATH", str(BASE_DIR / "data" / "app.db"))
DATABASE_PATH = Path(raw_db_path)
if not DATABASE_PATH.is_absolute():
    DATABASE_PATH = BASE_DIR / DATABASE_PATH

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "1") == "1"

DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

# AI 服务商预设（CC Switch 风格）：用户选择后自动填充 base_url，模型由“获取模型”拉取
AI_PROVIDERS = {
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    "kimi": {
        "name": "Kimi（月之暗面）",
        "base_url": "https://api.moonshot.cn/v1",
        "model": "moonshot-v1-8k",
    },
    "qwen": {
        "name": "通义千问",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
    },
    "zhipu": {
        "name": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-4-flash",
    },
    "siliconflow": {
        "name": "硅基流动",
        "base_url": "https://api.siliconflow.cn/v1",
        "model": "deepseek-ai/DeepSeek-V3",
    },
    "custom": {"name": "自定义", "base_url": "", "model": ""},
}

# 旧版本自动预填过的模型，升级时清掉，避免继续把“初始模型”留在配置里。
LEGACY_PRESET_MODELS = {
    "deepseek": ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-pro"],
    "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
    "kimi": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    "qwen": ["qwen-plus", "qwen-turbo", "qwen-max", "qwen3-plus", "qwen3-turbo"],
    "zhipu": ["glm-4-flash", "glm-4-plus", "glm-4-air", "glm-4-long"],
    "siliconflow": [
        "deepseek-ai/DeepSeek-V3",
        "deepseek-ai/DeepSeek-R1",
        "Qwen/Qwen2.5-7B-Instruct",
        "THUDM/glm-4-9b-chat",
    ],
}

# 艾宾浩斯遗忘曲线复习间隔（天），参考多邻国式递增复习
REVIEW_INTERVALS = [1, 2, 4, 7, 15]

COOKIE_NAME = "learn_session"
VERIFY_CODE_TTL_SECONDS = 300
SEND_INTERVAL_SECONDS = 60
EMAIL_CODE_LIMIT = int(os.getenv("EMAIL_CODE_LIMIT", "10"))
MAX_VERIFY_ATTEMPTS = 5
MAX_FILE_SIZE = 5 * 1024 * 1024
ALLOWED_EXTENSIONS = {".txt", ".md", ".cpp", ".h", ".py", ".pdf"}
DEFAULT_DAILY_LIMIT = 5
AI_TIMEOUT_SECONDS = 90
MODELS_TIMEOUT_SECONDS = 15


def fernet_key() -> bytes:
    digest = hashlib.sha256(APP_SECRET_KEY.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)
