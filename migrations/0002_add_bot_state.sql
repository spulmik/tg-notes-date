CREATE TABLE IF NOT EXISTS bot_state (
    telegram_id INTEGER PRIMARY KEY,
    state TEXT NOT NULL,
    selected_date TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);