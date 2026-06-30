import os

# База данных
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_NAME = os.path.join(BASE_DIR, 'registration.db')

# Настройки bcrypt (cost factor). 12 — хороший баланс скорости/безопасности
BCRYPT_ROUNDS = 12