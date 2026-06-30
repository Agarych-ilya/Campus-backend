import 'dotenv/config'; // <--- ДОЛЖНО БЫТЬ СТРОГО НА ПЕРВОЙ СТРОЧКЕ ФАЙЛА
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
