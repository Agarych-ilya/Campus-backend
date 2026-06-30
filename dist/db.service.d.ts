import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
export declare class DbService implements OnModuleInit, OnModuleDestroy {
    private connection;
    onModuleInit(): Promise<void>;
    query(sql: string, params?: any[]): Promise<mysql.QueryResult>;
    onModuleDestroy(): Promise<void>;
}
