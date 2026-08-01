import json
import re
import time
from contextlib import closing
from datetime import datetime

import httpx
from openai import OpenAI

from . import config
from .database import get_connection
from .settings import decrypt_secret

ANALYZE_SYSTEM = (
    "你是学习资料分析助手。请阅读用户上传的学习资料，完整提取全部核心知识点，"
    "不得遗漏文件中的任何知识点，也不能凭空增加文件里没有的内容。"
    "把知识点按内容主题分成若干个区块，每个知识点只能属于一个区块。"
    '只输出一个 JSON 对象，格式：{"blocks": [{"name": "区块名", "points": [{"title": "知识点标题", "description": "一句话说明", "difficulty": "易或中或难"}]}]}。'
    "不要输出 JSON 以外的任何文字。"
)

CARD_SYSTEM = (
    "你是出题助手。根据给定的知识点生成一道四选一选择题。"
    '只输出一个 JSON 对象，格式：{"question": "题干", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": "A", "explanation": "简短解析", "label": "必考或常考或加分"}。'
    "answer 必须是 A/B/C/D 中的一个字母。不要输出 JSON 以外的任何文字。"
)


class AIError(Exception):
    pass


def _openai_client(api_key: str, base_url: str, timeout: int, trust_env: bool = False) -> OpenAI:
    return OpenAI(
        base_url=base_url,
        api_key=api_key,
        timeout=timeout,
        http_client=httpx.Client(trust_env=trust_env),
    )


def list_models(
    api_key: str,
    base_url: str,
    timeout: int = config.MODELS_TIMEOUT_SECONDS,
    trust_env: bool = False,
) -> list[str]:
    """调用 OpenAI 兼容的官方 /models 接口，返回真实模型 ID 列表。"""
    url = base_url.rstrip("/") + "/models"
    with httpx.Client(trust_env=trust_env, timeout=timeout) as client:
        resp = client.get(url, headers={"Authorization": f"Bearer {api_key}"})
        resp.raise_for_status()
        payload = resp.json()
    if isinstance(payload, dict):
        items = payload.get("data") or payload.get("models") or payload.get("items") or []
    elif isinstance(payload, list):
        items = payload
    else:
        items = []
    model_ids = []
    for item in items:
        if isinstance(item, str):
            model_ids.append(item.strip())
        elif isinstance(item, dict):
            mid = item.get("id") or item.get("model") or item.get("name")
            if mid:
                model_ids.append(str(mid).strip())
    return sorted({mid for mid in model_ids if mid})


def _clean_json(content: str) -> str:
    content = content.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", content, re.S)
    if fence:
        content = fence.group(1).strip()
    return content


def _normalize_difficulty(value) -> str:
    text = str(value or "").strip()
    if text not in ("易", "中", "难"):
        return "中"
    return text


def _load_ai_config(conn, user_id: int) -> tuple[str, str, str]:
    providers = conn.execute(
        "SELECT * FROM provider_configs WHERE user_id = ? ORDER BY active DESC, id", (user_id,)
    ).fetchall()
    for prow in providers:
        if not prow["api_key_encrypted"]:
            continue
        api_key = decrypt_secret(prow["api_key_encrypted"])
        if not api_key:
            continue
        base_url = prow["base_url"] or config.DEEPSEEK_BASE_URL
        models = []
        try:
            models = json.loads(prow["models_json"] or "[]")
        except (ValueError, TypeError):
            models = []
        if not models or not isinstance(models[0], dict) or not models[0].get("model"):
            raise AIError("请先在服务商配置中添加并选择模型")
        model = str(models[0]["model"]).strip()
        return api_key, base_url, model
    row = conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()
    if row is None or not row["ai_api_key_encrypted"]:
        raise AIError("请先在设置页配置 AI API Key")
    api_key = decrypt_secret(row["ai_api_key_encrypted"])
    if not api_key:
        raise AIError("AI API Key 解密失败，请重新配置")
    base_url = row["ai_base_url"] or config.DEEPSEEK_BASE_URL
    model = (row["ai_model"] or "").strip()
    if not model:
        raise AIError("请先在服务商配置中添加并选择模型")
    return api_key, base_url, model


def _chat_json(api_key: str, base_url: str, model: str, messages: list, timeout: int = config.AI_TIMEOUT_SECONDS):
    last_error = None
    for use_json_mode in (True, False):
        for trust_env, channel in ((False, "直连"), (True, "代理")):
            try:
                client = _openai_client(api_key, base_url, timeout, trust_env=trust_env)
                kwargs = {"model": model, "messages": messages, "temperature": 0.2, "timeout": timeout}
                if use_json_mode:
                    kwargs["response_format"] = {"type": "json_object"}
                response = client.chat.completions.create(**kwargs)
                content = response.choices[0].message.content or ""
                return json.loads(_clean_json(content))
            except Exception as exc:  # noqa: BLE001
                last_error = exc
    raise AIError(f"直连和代理连接均失败，AI 返回内容解析失败，请重试：{last_error}")


def test_connection(
    user_id: int,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
) -> dict:
    with closing(get_connection()) as conn:
        saved_key, saved_url, saved_model = _load_ai_config(conn, user_id)
    api_key = api_key or saved_key
    base_url = base_url or saved_url
    model = model or saved_model

    last_error = None
    start = time.monotonic()
    for trust_env, channel in ((False, "直连"), (True, "代理")):
        try:
            client = _openai_client(api_key, base_url, config.AI_TIMEOUT_SECONDS, trust_env=trust_env)
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "请只回复：OK"}],
                max_tokens=8,
                temperature=0,
            )
            latency = round(time.monotonic() - start, 2)
            reply = (resp.choices[0].message.content or "").strip()
            return {"ok": True, "latency": latency, "reply": reply, "model": model, "channel": channel}
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise AIError(f"直连和代理连接均失败：{last_error}")


def analyze_zone(user_id: int, zone_id: int) -> list[dict]:
    with closing(get_connection()) as conn:
        api_key, base_url, model = _load_ai_config(conn, user_id)
        files = conn.execute(
            "SELECT id, filename, content FROM files WHERE zone_id = ? ORDER BY id", (zone_id,)
        ).fetchall()
        if not files:
            raise AIError("学习区还没有文件，请先上传文件")
        parts = []
        for f in files:
            text = (f["content"] or "")[:60000]
            parts.append(f"文件《{f['filename']}》：\n{text}")
        payload = "\n\n".join(parts)[:200000]

    messages = [
        {"role": "system", "content": ANALYZE_SYSTEM},
        {"role": "user", "content": payload},
    ]
    data = _chat_json(api_key, base_url, model, messages)
    data = data if isinstance(data, dict) else {}
    blocks = data.get("blocks") or []
    if not blocks and data.get("knowledge_points"):
        blocks = [{"name": "全部知识点", "points": data["knowledge_points"]}]
    result = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_name = str(block.get("name", "")).strip() or "未分区"
        for point in (block.get("points") or [])[:200]:
            if isinstance(point, dict) and point.get("title"):
                result.append(
                    {
                        "title": str(point["title"]),
                        "description": str(point.get("description", "")),
                        "block_name": block_name,
                        "difficulty": _normalize_difficulty(point.get("difficulty", "中")),
                    }
                )
    if not result:
        raise AIError("AI 未能识别出知识点，请重试")
    return result


def _parse_card(data: dict) -> dict:
    question = str(data.get("question", "")).strip()
    if not question:
        raise AIError("AI 返回的题干为空")
    options = data.get("options")
    if isinstance(options, dict):
        options = [options.get(k, "") for k in ("option_a", "option_b", "option_c", "option_d")]
    if not isinstance(options, list) or len(options) != 4 or not all(str(o).strip() for o in options):
        raise AIError("AI 返回的选项不完整")
    answer = str(data.get("answer", "")).strip().upper()
    if answer not in ("A", "B", "C", "D"):
        raise AIError("AI 返回的答案格式不正确")
    label = str(data.get("label", "常考")).strip()
    if label not in ("必考", "常考", "加分"):
        label = "常考"
    return {
        "question": question,
        "option_a": str(options[0]).strip(),
        "option_b": str(options[1]).strip(),
        "option_c": str(options[2]).strip(),
        "option_d": str(options[3]).strip(),
        "answer": answer,
        "explanation": str(data.get("explanation", "")).strip(),
        "label": label,
    }


def _generate_one_card(api_key: str, base_url: str, model: str, title: str, description: str) -> dict:
    user_content = f"知识点：{title}\n补充说明：{description}\n请生成一道选择题。"
    messages = [
        {"role": "system", "content": CARD_SYSTEM},
        {"role": "user", "content": user_content},
    ]
    data = _chat_json(api_key, base_url, model, messages, timeout=config.AI_TIMEOUT_SECONDS + 30)
    return _parse_card(data)


def generate_cards(user_id: int, zone_id: int, points: list[str]) -> dict:
    with closing(get_connection()) as conn:
        api_key, base_url, model = _load_ai_config(conn, user_id)
        first_file = conn.execute(
            "SELECT id FROM files WHERE zone_id = ? ORDER BY id LIMIT 1", (zone_id,)
        ).fetchone()
        if first_file is None:
            raise AIError("学习区还没有文件，请先上传文件")
        file_id = first_file["id"]
        if not points:
            raise AIError("请先执行分析并确认知识点")

        flat_points = []
        for item in points:
            if isinstance(item, dict) and isinstance(item.get("points"), list):
                flat_points.extend(item["points"])
            else:
                flat_points.append(item)
        points = flat_points
        normalized = []
        for point in points:
            if isinstance(point, dict):
                title = str(point.get("title", "")).strip()
                normalized.append(
                    {
                        "title": title,
                        "description": str(point.get("description", "")),
                        "block_name": str(point.get("block_name", "")).strip(),
                        "difficulty": _normalize_difficulty(point.get("difficulty", "中")),
                    }
                )
            else:
                title = str(point).strip()
                normalized.append({"title": title, "description": "", "block_name": "", "difficulty": "中"})

        generated = 0
        failed = []
        for index, point in enumerate(normalized, start=1):
            title = point["title"]
            if not title:
                continue
            try:
                card = _generate_one_card(api_key, base_url, model, title, point["description"])
            except AIError as exc:
                failed.append({"title": title, "error": str(exc)})
                continue
            duplicate = conn.execute(
                "SELECT id FROM cards WHERE file_id = ? AND title = ? AND question = ?",
                (file_id, title, card["question"]),
            ).fetchone()
            if duplicate is not None:
                continue
            conn.execute(
                """INSERT INTO cards (file_id, title, question, option_a, option_b, option_c, option_d, answer, explanation, label, block_name, difficulty, sort_order, status, wrong_count, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待学', 0, ?)""",
                (
                    file_id,
                    title,
                    card["question"],
                    card["option_a"],
                    card["option_b"],
                    card["option_c"],
                    card["option_d"],
                    card["answer"],
                    card["explanation"],
                    card["label"],
                    point["block_name"],
                    point["difficulty"],
                    index,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                ),
            )
            generated += 1
        conn.commit()
        return {"generated": generated, "failed": failed, "total": len(normalized)}
