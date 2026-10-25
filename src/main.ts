import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import session from 'express-session';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const adminEnabled = (process.env.COMMUNITY_ADMIN_USER_IDS ?? '').trim() !== '';
  const sessionSecret = process.env.SESSION_SECRET?.trim();

  // Legacy dev-only fallback is forbidden as soon as administrator rights
  // are enabled: otherwise signed session cookies could be forged.
  if (adminEnabled && (!sessionSecret || sessionSecret.length < 32)) {
    throw new Error(
      'Для админ-панели задай SESSION_SECRET длиной от 32 символов в .env',
    );
  }

  app.use(
    session({
      secret: sessionSecret && sessionSecret.length >= 32
        ? sessionSecret
        : 'my-secret-key',
      resave: false,
      saveUninitialized: false,
      name: 'campus.sid',
      cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        sameSite: 'lax',
        // Local USB debug uses HTTP via adb reverse. Deploy behind HTTPS
        // and enable secure cookies for production.
        secure: process.env.COOKIE_SECURE === 'true',
      },
    }),
  );

  const port = Number(process.env.PORT) || 8000;

  await app.listen(port, '0.0.0.0');
}

bootstrap();
