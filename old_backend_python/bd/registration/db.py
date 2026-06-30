# db.py
import sqlite3
from config import DB_NAME

def get_connection():
    """Возвращает соединение с БД и включает поддержку внешних ключей (на будущее)"""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row  # Чтобы обращаться к колонкам по именам
    return conn

def init_db():
    """Создаёт таблицу пользователей, если её нет"""
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()
    print("✅ База данных и таблица готовы к работе.")