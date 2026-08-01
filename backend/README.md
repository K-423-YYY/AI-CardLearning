# AI 闯关学习网站 · 后端

## 登录方案

- 邮箱 + 密码登录 / 注册
- 邮箱验证码快捷登录（首次登录自动注册）
- 忘记密码：邮箱验证码重置
- 登录态使用 HttpOnly Cookie

本地开发未配置 SMTP 时，验证码会打印到后端控制台，并在接口返回的 `data.dev_code` 中给出；生产环境（`APP_ENV=prod`）未配置 SMTP 会直接报错，不会返回验证码。

## 本地启动

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

浏览器访问：

- 前端页面：`http://localhost:8686`
- 接口文档：`http://localhost:8686/api/docs`
- 健康检查：`http://localhost:8686/api/health`

端口通过 `.env` 里的 `APP_PORT` 配置。

## 环境变量

```env
APP_ENV=dev
APP_SECRET_KEY=请替换为随机长字符串
APP_PORT=8686
DATABASE_PATH=./data/app.db

SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=you@example.com
SMTP_PASSWORD=你的SMTP授权码
SMTP_FROM=you@example.com
SMTP_USE_SSL=1
EMAIL_CODE_LIMIT=10

DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

## 认证接口

| 方法 | 路径 | 说明 |
|:-----|:-----|:-----|
| POST | `/api/auth/send-code` | 发送邮箱验证码，`purpose` 为 `login` / `register` / `reset` |
| POST | `/api/auth/login-code` | 邮箱验证码登录/自动注册 |
| POST | `/api/auth/register` | 邮箱验证码 + 密码注册 |
| POST | `/api/auth/login` | 邮箱 + 密码登录 |
| POST | `/api/auth/reset-password` | 邮箱验证码重置密码 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/me` | 当前用户信息 |

## 测试

```bash
venv\Scripts\python.exe -m pytest tests -q
```
