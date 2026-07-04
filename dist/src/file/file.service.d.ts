import { DbService } from '../../db.service';
export declare class FileService {
    private db;
    constructor(db: DbService);
    postFile(file: Express.Multer.File): Promise<{
        filename: string;
        path: string;
    }>;
    getFile(id: string): Promise<{
        message: string;
        path: any;
    }>;
    deleteFile(id: string): Promise<{
        message: string;
    }>;
}
