SCHEMA = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    nickname TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'login'
);

CREATE TABLE IF NOT EXISTS learning_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '进行中',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL REFERENCES learning_zones(id),
    filename TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id),
    title TEXT NOT NULL,
    question TEXT NOT NULL,
    option_a TEXT NOT NULL DEFAULT '',
    option_b TEXT NOT NULL DEFAULT '',
    option_c TEXT NOT NULL DEFAULT '',
    option_d TEXT NOT NULL DEFAULT '',
    answer TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '常考',
    block_name TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL DEFAULT '中',
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT '待学',
    wrong_count INTEGER NOT NULL DEFAULT 0,
    review_stage INTEGER NOT NULL DEFAULT 0,
    correct_streak INTEGER NOT NULL DEFAULT 0,
    lapse_count INTEGER NOT NULL DEFAULT 0,
    last_review_at TEXT,
    last_wrong_at TEXT,
    last_correct_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    is_correct INTEGER NOT NULL DEFAULT 0,
    level_no INTEGER,
    answered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    daily_card_limit INTEGER NOT NULL DEFAULT 5,
    ai_provider TEXT NOT NULL DEFAULT 'deepseek',
    ai_base_url TEXT NOT NULL DEFAULT '',
    ai_model TEXT NOT NULL DEFAULT '',
    ai_api_key_encrypted TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS provider_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT 'custom',
    base_url TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 0,
    fetched_models_json TEXT NOT NULL DEFAULT '[]',
    models_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zone_settings (
    zone_id INTEGER PRIMARY KEY REFERENCES learning_zones(id),
    daily_limit INTEGER NOT NULL DEFAULT 5,
    level_count INTEGER,
    sort_mode TEXT NOT NULL DEFAULT 'easy_to_hard',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL REFERENCES learning_zones(id),
    level_no INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    level_type TEXT NOT NULL DEFAULT '新学',
    day_no INTEGER,
    new_count INTEGER NOT NULL DEFAULT 0,
    daily_limit INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT '待闯关',
    completed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(zone_id, level_no)
);

CREATE TABLE IF NOT EXISTS level_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL REFERENCES learning_zones(id),
    level_no INTEGER NOT NULL,
    card_id INTEGER NOT NULL REFERENCES cards(id),
    role TEXT NOT NULL DEFAULT '新学',
    created_at TEXT NOT NULL,
    UNIQUE(zone_id, level_no, card_id)
);

CREATE TABLE IF NOT EXISTS level_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    zone_id INTEGER NOT NULL REFERENCES learning_zones(id),
    level_no INTEGER NOT NULL,
    review_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    UNIQUE(user_id, zone_id, level_no, review_date)
);

CREATE TABLE IF NOT EXISTS daily_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    zone_id INTEGER NOT NULL REFERENCES learning_zones(id),
    card_id INTEGER NOT NULL REFERENCES cards(id),
    task_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    position INTEGER NOT NULL DEFAULT 0,
    level_no INTEGER,
    mode TEXT NOT NULL DEFAULT 'daily',
    review_mode TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_codes ON email_codes(email, sent_at);
CREATE INDEX IF NOT EXISTS idx_zones_user ON learning_zones(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_files_zone ON files(zone_id);
CREATE INDEX IF NOT EXISTS idx_cards_file ON cards(file_id, status);
CREATE INDEX IF NOT EXISTS idx_records_card ON learning_records(card_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_tasks_zone_date ON daily_tasks(user_id, zone_id, task_date, status);
CREATE INDEX IF NOT EXISTS idx_levels_zone ON levels(zone_id, level_no);
CREATE INDEX IF NOT EXISTS idx_level_cards_zone ON level_cards(zone_id, level_no, role);
CREATE INDEX IF NOT EXISTS idx_level_reviews_due ON level_reviews(user_id, zone_id, review_date, status);
CREATE INDEX IF NOT EXISTS idx_providers_user ON provider_configs(user_id, active);

CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    zone_id INTEGER NOT NULL REFERENCES learning_zones(id),
    checkin_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, zone_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS review_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    zone_id INTEGER NOT NULL REFERENCES learning_zones(id),
    card_id INTEGER NOT NULL REFERENCES cards(id),
    review_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    UNIQUE(user_id, card_id, review_date)
);

CREATE INDEX IF NOT EXISTS idx_review_date ON review_schedule(user_id, zone_id, review_date, status);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(user_id, checkin_date);
"""
