import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import session from 'express-session';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.use(
    session({
      secret: 'my-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // семь дней по моему
        httpOnly: true,
        secure: false
      },
    }),
  );

  const port = Number(process.env.PORT) || 8000;
  
  await app.listen(port, '0.0.0.0');
}

bootstrap();