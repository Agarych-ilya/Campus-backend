import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto/create-auth.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(body: RegisterDto): Promise<{
        message: string;
    }>;
    login(body: LoginDto): Promise<{
        message: string;
    }>;
}
