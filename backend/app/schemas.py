from typing import Optional

from pydantic import BaseModel, Field


class SendCodeRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    purpose: Optional[str] = "login"


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=6, max_length=128)


class CodeLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    code: str = Field(..., min_length=6, max_length=6)


class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    code: str = Field(..., min_length=6, max_length=6)
    password: str = Field(..., min_length=6, max_length=128)


class ResetPasswordRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    code: str = Field(..., min_length=6, max_length=6)
    password: str = Field(..., min_length=6, max_length=128)


class ZoneCreate(BaseModel):
    name: Optional[str] = None


class ZoneSettingsUpdate(BaseModel):
    daily_card_limit: Optional[int] = Field(None, ge=1, le=100)
    sort_mode: Optional[str] = None


class LevelLayoutRequest(BaseModel):
    level_count: int = Field(..., ge=1, le=200)


class AnalyzeRequest(BaseModel):
    file_ids: Optional[list[int]] = None


class GenerateRequest(BaseModel):
    knowledge_points: Optional[list[str]] = None
    blocks: Optional[list[dict]] = None
    replace_old: str = "none"
    delete_card_ids: Optional[list[int]] = None


class CardBatchRequest(BaseModel):
    card_ids: list[int] = Field(..., min_length=1)


class AnswerRequest(BaseModel):
    option: str = Field(..., min_length=1, max_length=1)
    mode: str = "daily"
    level_no: Optional[int] = None


class SettingsUpdate(BaseModel):
    nickname: Optional[str] = None
    daily_card_limit: Optional[int] = Field(None, ge=1, le=100)
    ai_provider: Optional[str] = None
    ai_base_url: Optional[str] = None
    ai_model: Optional[str] = None
    ai_api_key: Optional[str] = None


class ProviderCreate(BaseModel):
    name: Optional[str] = None
    provider_id: str = "custom"
    base_url: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    models: Optional[list[dict]] = None
