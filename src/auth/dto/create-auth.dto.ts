import 'class-validator';
import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterDto {
    @IsString({message: 'Имя пользователя должно быть строкой'})
    @Length(2, 100, {message: 'Длина имени должна быть от 2 до 100'})
    username!: string;

    @IsEmail({}, {message: 'Неверный формат почты'})
    email!: string;

    @IsString({message: 'Пароль должен быть строкой. фронтендеру руки оторвать, чини это давай. Либо тут вообще без пароля кинули'})
    @Length(6, 100, {message: 'Длина пароля должна быть от 2 до 100'})
    password!: string;
}

export class LoginDto {
    @IsEmail({}, {message: 'Неверный формат почты'})
    email!: string;

    @IsString({message: 'Пароль должен быть строкой. фронтендеру руки оторвать, чини это давай. Либо тут вообще без пароля кинули'})
    @Length(6, 100, {message: 'Длина пароля должна быть от 2 до 100'})
    password!: string;
}