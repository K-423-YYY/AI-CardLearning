# AI 闯关学习网站 · 统一完整方案

> 版本：V1.0  
> 日期：2026-07-31  
> 状态：方案评审稿，未开始开发  
> 原则：轻量、快速完成、低成本；开发工作量预计 4 到 5 天

---

## 1. 项目概述

### 1.1 项目定位

一个带专属域名的 AI 闯关学习网站：用户用手机号短信登录，上传学习资料后由 AI 自动生成知识卡片，通过"每日限量 + 闯关答题 + 错题打乱重做"的方式完成学习。

### 1.2 目标用户

- 正在自学编程、考证、备考的普通用户
- 希望用 AI 把杂乱资料变成可刷题卡片的人
- 需要真实手机号登录和独立域名的小型学习产品

### 1.3 核心价值

- 资料自动变卡片：上传文件即生成结构化知识卡片
- 科学学习机制：提取练习、交错练习、错题重排、间隔复习
- 进度清晰：完成一张标记一张，只保留错题和未完成卡片
- 零平台 AI 成本：AI 费用走用户自己的 API Key

### 1.4 北极星指标

学习区卡片通关完成率。产品目标是让用户真正学完，而不是只看注册量。

### 1.5 核心原则

1. MVP 只做一条主链路：登录 → 建学习区 → 传文件 → 生成卡片 → 闯关学习 → 记录进度
2. 技术方案轻量：一个仓库、一个后端进程、一个 SQLite 数据库、静态前端
3. 上线成本可控：域名 + 轻量服务器 + 按量短信，无固定大额支出

---

## 2. 功能需求

### 2.1 手机号短信登录

**流程**

1. 用户输入 11 位手机号，点击"发送验证码"
2. 后端校验手机号格式，生成 6 位随机验证码
3. 验证码保存为哈希，有效期 5 分钟
4. 调用短信服务商发送验证码
5. 用户输入验证码，后端校验通过后签发登录态
6. 登录态使用 HttpOnly Cookie 保存，浏览器自动携带

**限制**

- 同一手机号 60 秒内不可重复发送
- 同一手机号每天最多发送 5 条
- 验证码最多验证 5 次，超过则作废
- 未注册手机号首次验证码登录时自动创建账号

### 2.2 AI 接口配置

**默认 DeepSeek**

- 新用户默认选择 DeepSeek
- 接口地址：`https://api.deepseek.com`
- 默认模型：`deepseek-chat`
- 用户只需填写自己的 DeepSeek API Key

**自定义第三方 API**

- 设置页提供"服务商模板"下拉：DeepSeek / 自定义
- 自定义模式开放三个字段：接口地址、API Key、模型名
- 兼容 DeepSeek、OpenAI、Kimi、通义等所有 OpenAI 兼容服务
- API Key 加密存储在后端，不展示在前端页面

### 2.3 学习区管理

- 每次学习可以新建学习区并导入文件
- 也可以从历史学习区列表中选择继续学习
- 学习区内可追加新文件
- 学习区展示卡片总数、已通关数、上次学习时间

### 2.4 知识卡片生成

- 支持文件类型：txt、md、cpp、h、py、pdf 文本等
- 上传后 AI 先扫描文件，输出"知识点清单"
- 用户确认或勾选后，AI 批量生成知识卡片
- 每张卡片结构固定：
  - 题干
  - 4 个选项
  - 正确答案
  - 简短解析
  - 面试/考试标签（必考、常考、加分）
- 生成失败可重试，不产生重复卡片

### 2.5 闯关学习机制

**每日限额**

- 用户可在设置中自定义每天学习卡片数，默认 5 张
- 每日任务 = 新卡片 N 张 + 当日错题
- 用户必须把当日任务全部答对，才算"今日通关"
- 中途退出时，未完成卡片顺延到下次

**答题规则**

- 每张卡片展示题干和 4 个乱序选项
- 答对：立即显示解析，卡片标记成功，移出今日队列
- 答错：显示正确答案和解析，卡片回到队列末尾
- 错题重新出现时，卡片顺序和选项顺序都重新打乱
- 同一卡片连续答错 3 次：标记"重点复习"，当日不再反复出现，次日优先安排

### 2.6 进度与完成

- 已通关卡片直接标记成功
- 学习区只保留错题和未完成卡片
- 学习区全部卡片通关后，学习区标记"已完成"
- 已完成学习区可随时进入复习模式

### 2.7 用户设置

- 手机号（只读）
- 昵称
- 每日学习卡片数
- AI 服务商、接口地址、API Key、模型名
- 退出登录

---

## 3. 核心流程

### 3.1 登录流程

```text
输入手机号 → 发送验证码 → 短信送达 → 输入验证码 → 校验通过 → 创建/登录账号 → 进入首页
```

### 3.2 新建学习区流程

```text
首页点击"新建学习区" → 填写名称（可自动生成） → 上传文件 → AI 扫描 → 生成知识点清单 → 用户确认 → 生成卡片
```

### 3.3 卡片生成流程

```text
读取文件文本 → 按长度分段 → 调用 DeepSeek/自定义 API → 返回结构化 JSON → 校验字段 → 写入数据库 → 展示卡片清单
```

### 3.4 每日学习流程

```text
进入学习区 → 取今日任务（N 张新卡 + 当日错题） → 打乱卡片顺序 → 逐张答题
答对 → 标记成功并移出
答错 → 记录错题 → 卡片回到队列末尾 → 下次出现时重新打乱卡片与选项顺序
重复直到今日任务全部答对 → 今日通关
```

### 3.5 错题重排算法

```text
1. 今日队列初始 = 新卡片 N 张，随机打乱
2. 取出队首卡片，选项随机打乱后展示
3. 答对：卡片标记 success，从队列移除
4. 答错：显示解析，卡片加入队尾，错误次数 +1
5. 错题重新出队时，重新打乱选项顺序
6. 队列清空 = 今日通关
```

### 3.6 学习区完成判定

```text
学习区状态 = 进行中 → 全部卡片 status = success → 学习区状态 = 已完成
```

---

## 4. 页面结构

| 页面 | 功能 | 核心操作 |
|:-----|:-----|:---------|
| 登录页 | 手机号 + 验证码 | 发送验证码、登录 |
| 首页 | 学习区列表 | 新建学习区、选择历史学习区 |
| 学习区详情 | 文件与卡片进度 | 追加文件、生成卡片、开始学习 |
| 学习页 | 闯关答题 | 选择答案、查看解析、标记成功 |
| 设置页 | 账号与 AI 配置 | 每日卡片数、API 配置、退出登录 |

---

## 5. 数据模型

### users（用户）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| id | INTEGER PK | 用户 ID |
| phone | TEXT UNIQUE | 手机号 |
| nickname | TEXT | 昵称 |
| created_at | TEXT | 注册时间 |

### sms_codes（短信验证码）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| id | INTEGER PK | 记录 ID |
| phone | TEXT | 手机号 |
| code_hash | TEXT | 验证码哈希 |
| expires_at | TEXT | 过期时间 |
| attempts | INTEGER | 验证次数 |
| sent_at | TEXT | 发送时间 |

### learning_zones（学习区）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| id | INTEGER PK | 学习区 ID |
| user_id | INTEGER FK | 所属用户 |
| name | TEXT | 学习区名称 |
| status | TEXT | 进行中 / 已完成 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 最近学习时间 |

### files（文件）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| id | INTEGER PK | 文件 ID |
| zone_id | INTEGER FK | 所属学习区 |
| filename | TEXT | 文件名 |
| content | TEXT | 文本内容 |
| created_at | TEXT | 上传时间 |

### cards（知识卡片）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| id | INTEGER PK | 卡片 ID |
| file_id | INTEGER FK | 来源文件 |
| title | TEXT | 知识点标题 |
| question | TEXT | 题干 |
| option_a | TEXT | 选项 A |
| option_b | TEXT | 选项 B |
| option_c | TEXT | 选项 C |
| option_d | TEXT | 选项 D |
| answer | TEXT | 正确答案 |
| explanation | TEXT | 解析 |
| label | TEXT | 必考 / 常考 / 加分 |
| status | TEXT | 待学 / 成功 / 重点复习 |
| wrong_count | INTEGER | 累计错误次数 |
| created_at | TEXT | 生成时间 |

### learning_records（学习记录）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| id | INTEGER PK | 记录 ID |
| card_id | INTEGER FK | 卡片 ID |
| user_id | INTEGER FK | 用户 ID |
| is_correct | INTEGER | 是否正确 |
| answered_at | TEXT | 作答时间 |

### user_settings（用户设置）

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| user_id | INTEGER PK/FK | 用户 ID |
| daily_card_limit | INTEGER | 每日卡片数，默认 5 |
| ai_provider | TEXT | deepseek / custom |
| ai_base_url | TEXT | 接口地址 |
| ai_model | TEXT | 模型名 |
| ai_api_key_encrypted | TEXT | 加密后的 API Key |

---

## 6. 前端配置方案

### 6.1 技术选型

- Vue 3：通过 CDN 引入，无构建步骤，文件少、上手快
- 原生 CSS：手写一个轻量样式系统，不做 UI 组件库
- 页面路由：Hash 路由（`#/login`、`#/zones`、`#/learn`）
- 请求：浏览器原生 `fetch`

### 6.2 目录结构

```text
frontend/
  index.html
  css/app.css
  js/
    api.js          # 所有后端接口封装
    router.js       # Hash 路由
    app.js          # Vue 根实例
    views/
      LoginView.js
      HomeView.js
      ZoneView.js
      LearnView.js
      SettingsView.js
```

### 6.3 与后端交互约定

- 所有接口前缀：`/api`
- 登录态：HttpOnly Cookie 自动携带，无需前端存 Token
- 响应格式统一：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

### 6.4 UI 要求

- 移动端优先，手机浏览器为主要使用场景
- 答题页大按钮、单手可操作
- 进度条展示"今日任务 x/N"
- 所有文字不超出容器，按钮固定高度

---

## 7. 后端配置方案

### 7.1 技术选型

- Python 3.10+
- FastAPI：路由、参数校验、文档自动生成
- Uvicorn：应用服务器
- SQLite：Python 内置，零运维，单文件数据库
- PyJWT：登录态签名
- openai SDK：调用 DeepSeek 及 OpenAI 兼容接口
- 阿里云短信 SDK：发送验证码
- python-dotenv：读取环境变量

### 7.2 目录结构

```text
backend/
  app/
    main.py           # FastAPI 入口
    database.py       # SQLite 连接与初始化
    auth.py           # 登录、验证码、Cookie
    sms.py            # 短信发送
    ai.py             # 卡片生成与 AI 调用
    zones.py          # 学习区接口
    cards.py          # 卡片与答题接口
    settings.py       # 用户设置接口
    models.py         # 建表 SQL
    schemas.py        # 请求/响应模型
  requirements.txt
  .env.example
  run.py
```

### 7.3 接口清单

| 方法 | 路径 | 说明 |
|:-----|:-----|:-----|
| POST | /api/auth/send-code | 发送验证码 |
| POST | /api/auth/login | 验证码登录 |
| POST | /api/auth/logout | 退出登录 |
| GET | /api/me | 当前用户信息 |
| GET | /api/zones | 学习区列表 |
| POST | /api/zones | 新建学习区 |
| GET | /api/zones/{id} | 学习区详情 |
| POST | /api/zones/{id}/files | 上传文件 |
| POST | /api/zones/{id}/analyze | AI 扫描知识点 |
| POST | /api/zones/{id}/generate | 确认生成卡片 |
| GET | /api/zones/{id}/cards | 卡片列表 |
| GET | /api/zones/{id}/today | 今日任务 |
| POST | /api/cards/{id}/answer | 提交答案 |
| GET | /api/settings | 读取设置 |
| PUT | /api/settings | 更新设置 |

### 7.4 关键实现说明

- 验证码存哈希，不存明文
- API Key 使用 Fernet 加密后入库，解密只发生在后端调用 AI 时
- AI 生成要求返回严格 JSON，解析失败自动重试 1 次
- 答题接口是闯关核心，状态机保证同一卡片不会被并发重复提交

---

## 8. 服务器与部署配置方案

### 8.1 域名

- 建议注册简短 `.com` 或 `.cn` 域名
- 备案说明：使用香港/海外服务器可免 ICP 备案快速上线；后续迁国内服务器再备案

### 8.2 服务器

- 推荐：香港轻量云服务器，2 核 2G，40G 系统盘
- 系统：Ubuntu 22.04 LTS
- 用途：Nginx 静态前端 + 反向代理 + 后端进程 + SQLite

### 8.3 部署架构

```text
用户浏览器 → HTTPS → 域名 → Nginx → 前端静态文件 /api 反向代理 → Uvicorn(FastAPI) → SQLite
                                                                              ↓
                                                          短信服务 / DeepSeek API
```

### 8.4 生产部署流程

1. 域名解析 A 记录指向服务器 IP
2. 安装 Nginx、Python 3.10、venv
3. 上传项目代码，创建虚拟环境并安装依赖
4. 配置 `.env`：短信密钥、JWT 密钥等
5. 使用 systemd 启动后端服务
6. 配置 Nginx 反代 `/api` 和静态文件
7. 使用 certbot 申请免费 HTTPS 证书
8. 验证登录、短信、卡片生成、答题全流程

### 8.5 Nginx 核心配置示意

```nginx
server {
    listen 443 ssl;
    server_name learn.example.com;

    ssl_certificate     /etc/letsencrypt/live/learn.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/learn.example.com/privkey.pem;

    location / {
        root /var/www/learn/frontend;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 8.6 备份方案

- SQLite 数据文件每日自动复制到备份目录
- 备份内容：`app.db`、`.env` 的加密副本
- 恢复方式：停服务 → 覆盖数据文件 → 启动服务

---

## 9. 短信服务配置方案

### 9.1 服务商选择

- 推荐阿里云短信，按条计费，成本低
- 需要：实名认证账号、短信签名、短信模板

### 9.2 准备内容

| 项目 | 示例 |
|:-----|:-----|
| 短信签名 | AI闯关学习 |
| 短信模板 | 您的验证码是{1}，5分钟内有效，请勿泄露 |
| AccessKey ID | 后端环境变量 |
| AccessKey Secret | 后端环境变量 |

### 9.3 发送失败处理

- 记录失败日志，不把验证码写进日志
- 同一手机号失败后需等待 60 秒再重试
- 模板或签名未审核通过时，接口返回明确错误提示

---

## 10. AI 配置方案

### 10.1 DeepSeek 默认配置

```text
base_url = https://api.deepseek.com
model    = deepseek-chat
```

### 10.2 自定义配置

用户可填写任意 OpenAI 兼容接口：

```text
base_url = https://api.openai.com/v1
model    = gpt-4o-mini
```

### 10.3 卡片生成请求要点

- 调用 `/chat/completions`
- 使用 JSON response 格式要求模型返回结构化字段
- 系统提示词固定教学模板：每个知识点生成题干、4 选项、答案、解析、标签
- 输出字段缺失或格式错误时重试 1 次，仍失败则标记该卡片生成失败，可手动重试

### 10.4 Key 安全

- 用户 API Key 加密后存数据库
- 前端永远不返回完整 Key
- 平台不保存用户的 Key 明文日志

---

## 11. 安全与合规

- 全站 HTTPS
- 短信验证码防刷：频率限制 + 每日上限 + 验证次数限制
- 验证码只存哈希
- 登录态使用 HttpOnly + Secure Cookie
- API Key 加密存储
- 文件上传限制大小（默认 5MB）和类型
- 用户数据按手机号隔离，只能访问自己的学习区
- 若使用国内服务器，需完成 ICP 备案和短信签名资质要求

---

## 12. 环境配置方案

### 12.1 本地开发环境

**基础环境**

- Windows / macOS / Linux 均可
- Python 3.10 或更高
- 无需安装数据库，SQLite 为 Python 内置
- 前端无构建工具，无需 Node.js

**后端依赖 `requirements.txt`**

```text
fastapi
uvicorn
pyjwt
python-dotenv
openai
aliyun-python-sdk-core
aliyun-python-sdk-dysmsapi
cryptography
```

**`.env.example` 环境变量**

```text
# 运行环境
APP_ENV=dev
APP_SECRET_KEY=请生成随机密钥

# 数据库
DATABASE_PATH=./data/app.db

# 短信（阿里云）
SMS_ACCESS_KEY_ID=你的AccessKeyID
SMS_ACCESS_KEY_SECRET=你的AccessKeySecret
SMS_SIGN_NAME=AI闯关学习
SMS_TEMPLATE_CODE=SMS_000000

# 默认 AI（DeepSeek 由用户填写，这里只留可选平台默认值）
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

**启动命令**

```bash
cd backend
python -m venv venv
venv/Scripts/activate          # Windows
source venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
cp .env.example .env
python run.py
```

浏览器访问：`http://localhost:8000`

### 12.2 生产环境

**服务器基础安装（Ubuntu 22.04）**

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx
sudo apt install -y certbot python3-certbot-nginx
```

**启动后端（systemd 示意）**

```ini
[Unit]
Description=AI Learn App
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/learn/backend
ExecStart=/var/www/learn/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

**申请 HTTPS 证书**

```bash
sudo certbot --nginx -d learn.example.com
```

### 12.3 环境变量生产注意事项

- `APP_SECRET_KEY` 必须使用长随机字符串
- 短信 AccessKey 使用最小权限子账号
- `.env` 文件权限设为仅服务用户可读
- 数据库目录需要写权限

---

## 13. 成本估算

| 项目 | 单价 | 说明 |
|:-----|:-----|:-----|
| 域名 | 约 60 到 80 元/年 | .com 或 .cn |
| 香港轻量服务器 | 约 50 到 100 元/月 | 2 核 2G 足够 |
| HTTPS 证书 | 0 元 | Let's Encrypt 免费 |
| 短信 | 约 0.04 到 0.06 元/条 | 按量计费 |
| AI 调用 | 用户自己承担 | 使用用户自己的 API Key |
| 开发依赖 | 0 元 | 全部开源免费 |

---

## 14. 开发排期

| 天数 | 内容 | 产出 |
|:-----|:-----|:-----|
| 第 1 天 | 项目骨架 + 数据库 + 短信登录 | 可登录 |
| 第 2 天 | 学习区 + 文件上传 + AI 卡片生成 | 可生成卡片 |
| 第 3 天 | 闯关答题 + 错题重排 + 每日限额 | 可完成学习闭环 |
| 第 4 天 | 前端页面完善 + 移动端适配 | 全流程可用 |
| 第 5 天 | 域名、HTTPS、服务器部署、联调 | 正式上线 |

---

## 15. 上线验收清单

- [ ] 手机号验证码能真实收到短信
- [ ] 验证码错误、过期、刷频均有正确提示
- [ ] 用户可上传文件并生成卡片
- [ ] 默认 DeepSeek 配置可直接生成卡片
- [ ] 自定义第三方 API 可切换
- [ ] 每日卡片数设置生效
- [ ] 答对卡片标记成功，错题乱序重做
- [ ] 全部卡片通关后学习区标记完成
- [ ] 域名 HTTPS 可访问
- [ ] SQLite 备份恢复演练通过

---

## 16. 待确认事项

1. 最终域名选什么
2. 服务器选香港（免备案快上线）还是国内（合规但需备案）
3. 短信服务商确认阿里云还是腾讯云
4. 默认每日卡片数 5 张是否合适
5. 上线后是否开放注册，还是仅限邀请手机号
