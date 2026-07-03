import { FileService } from './file.service';
import 'multer';
export declare class FileController {
    private readonly fileService;
    constructor(fileService: FileService);
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
