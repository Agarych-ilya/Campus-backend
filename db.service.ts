import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as mysql from 'mysql2/promise';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private connection!: mysql.Connection;

  async onModuleInit() {
    // Подключаемся к MySQL напрямую по твоим доступам
    this.connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'motluk',
      database: 'campus_db',
    });
    console.log('Успешное подключение к MySQL!');
  }

  // Метод для выполнения любых SQL запросов
  async query(sql: string, params?: any[]) {
    const [rows] = await this.connection.execute(sql, params);
    return rows;
  }

  async onModuleDestroy() {
    await this.connection.end();
  }
}
