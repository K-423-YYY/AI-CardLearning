from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import HTTPException
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth, cards, providers, settings as settings_api, zones
from .config import BASE_DIR
from .database import init_db

init_db()

app = FastAPI(
    title="AI 闯关学习网站 API",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    detail = exc.detail
    if isinstance(detail, dict):
        body = {
            "code": detail.get("code", exc.status_code),
            "message": detail.get("message", "error"),
            "data": None,
        }
    else:
        body = {"code": exc.status_code, "message": str(detail), "data": None}
    return JSONResponse(body, status_code=exc.status_code)


@app.get("/api/openapi.json", include_in_schema=False)
def openapi_json():
    return app.openapi()


@app.get("/api/docs", include_in_schema=False)
def swagger_ui():
    return get_swagger_ui_html(openapi_url="/api/openapi.json", title="API 文档")


@app.get("/api/redoc", include_in_schema=False)
def redoc_ui():
    return get_redoc_html(openapi_url="/api/openapi.json", title="API 文档")


app.include_router(auth.router)
app.include_router(zones.router)
app.include_router(cards.router)
app.include_router(settings_api.router)
app.include_router(providers.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


FRONTEND_DIR = BASE_DIR.parent / "frontend"
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:

    @app.get("/")
    def root():
        return JSONResponse(
            {
                "code": 0,
                "message": "后端已启动。前端目录尚未生成，可访问 /api/docs 查看接口文档。",
                "data": None,
            }
        )
