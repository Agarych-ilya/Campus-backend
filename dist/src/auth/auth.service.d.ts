import { RegisterDto, LoginDto } from './dto/create-auth.dto';
import { DbService } from '../../db.service';
export declare class AuthService {
    private db;
    constructor(db: DbService);
    register(request: RegisterDto): Promise<{
        message: string;
    }>;
    login(request: LoginDto): Promise<{
        message: string;
    }>;
}
