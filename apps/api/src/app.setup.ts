import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { Env } from './common/config/env';

export function configureApp(app: NestExpressApplication, env: Env): void {
  app.setGlobalPrefix('api/v1');
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  // No credentials: the API authenticates with bearer tokens, never cookies.
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Tenant-Id', 'Idempotency-Key'],
  });

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder().setTitle('TahiPh API').addBearerAuth().build();
    SwaggerModule.setup(
      'api/docs',
      app,
      cleanupOpenApiDoc(SwaggerModule.createDocument(app, config)),
    );
  }
}
