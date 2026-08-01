from fastapi.responses import JSONResponse


def ok(data=None, message: str = "ok") -> JSONResponse:
    return JSONResponse({"code": 0, "message": message, "data": data})


def fail(code: int, message: str, http_status: int | None = None) -> JSONResponse:
    return JSONResponse(
        {"code": code, "message": message, "data": None},
        status_code=http_status if http_status is not None else code,
    )
