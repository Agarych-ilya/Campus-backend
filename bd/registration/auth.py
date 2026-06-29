import sqlite3
import bcrypt

from db import get_connection
from config import BCRYPT_ROUNDS

def hash_password(password: str) -> str:
    """Принимает строку пароля, возвращает хэш в виде строки"""
    salt = bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(password: str, password_hash: str) -> bool:
    """Проверяет, совпадает ли пароль с хэшем"""
    return bcrypt.checkpw(
        password.encode('utf-8'), 
        password_hash.encode('utf-8'),
    )

def register_user(username: str, email: str, password: str) -> tuple[bool, str]:
    """
    Регистрирует нового пользователя.
    Возвращает: (успешно_ли, сообщение_или_данные)
    """
    # 1. Валидация (минимальная)
    if len(password) < 6:
        return False, "Пароль должен содержать минимум 6 символов"
    
    # 2. Хэшируем пароль
    hashed = hash_password(password)
    
    # 3. Сохраняем в БД
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            INSERT INTO users (username, email, password_hash)
            VALUES (?, ?, ?)
        ''', (username, email, hashed))
        conn.commit()
        return True, f"Пользователь '{username}' успешно зарегистрирован!"
    except sqlite3.IntegrityError as e:
        # Определяем, что именно нарушило уникальность
        if 'email' in str(e).lower():
            return False, "Этот email уже используется"
        return False, f"Ошибка базы данных: {e}"
    finally:
        conn.close()

def login_user(email: str, password: str) -> tuple[bool, str | dict]:
    """
    Проверяет данные для входа.
    Возвращает: (успешно_ли, сообщение_или_данные_пользователя)
    """

    email = email.strip().lower()

    conn = get_connection()
    cursor = conn.cursor()
    
    # Ищем пользователя по имени (или можно по email)
    cursor.execute('''
        SELECT id, username, email, password_hash 
        FROM users 
        WHERE email = ?
    ''', (email,))
    
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return False, "Пользователь с таким email не нфйден"
    
    if not verify_password(password, user['password_hash']):
        return False, "Неверный пароль"
    
    return True, {
        'id': user['id'],
        'username': user['username'],
        'email': user['email']
    }