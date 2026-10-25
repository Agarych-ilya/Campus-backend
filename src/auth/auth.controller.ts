import { Controller, Post, Body, UsePipes, ValidationPipe, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto/create-auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('register')
  @UsePipes(new ValidationPipe()) // для использования dto
  async register(@Body() body: RegisterDto, @Req() req: any) {
    const userData = await this.authService.register(body);

    req.session.user = {
      id: userData.id,
      username: userData.username,
      email: userData.email
    }

    return { message: 'Success!', success: true };
  }

  @Post('login')
  @UsePipes(new ValidationPipe())
  async login(@Body() body: LoginDto, @Req() req: any) {
    const userData = await this.authService.login(body)
    
    req.session.user = {
      id: userData.id,
      username: userData.username,
      email: userData.email
    };

    return { message: 'Success!', success: true };
  }
}
