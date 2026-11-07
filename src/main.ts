import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import session from 'express-session';
import { communityAdminEnabled } from './auth/admin_identity';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Native Flutter HTTP clients do not send an Origin header.
  // Allow explicit trusted web frontends only; never reflect arbitrary origins
  // when administrator session cookies are enabled.
  const browserOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || browserOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Origin is not authorized for this API'), false);
      }
    },
    credentials: true,
  });

  const adminEnabled = communityAdminEnabled();
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
