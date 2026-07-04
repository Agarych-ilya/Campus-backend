import { IsString } from "class-validator";

export class UploadFileDto {
    @IsString({message: 'Должно быть строкой'})
    filename!: string

    @IsString({message: 'Должно быть строкой'})
    path!: string
}