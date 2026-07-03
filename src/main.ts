import 'dotenv/config'; // <--- ДОЛЖНО БЫТЬ СТРОГО НА ПЕРВОЙ СТРОЧКЕ ФАЙЛА
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*', // Разрешает запросы со всех доменов
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  
  await app.listen(3000);
}
bootstrap();
