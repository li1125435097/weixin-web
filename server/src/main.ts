import 'reflect-metadata';
import { Logger, type NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { AppModule } from './app.module';

loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../../.env') });

function webRoot(): string {
  if (process.env.WEB_ROOT) return resolve(process.env.WEB_ROOT);
  return resolve(__dirname, '..', '..', 'web', 'dist');
}

function tlsOptions(): NestApplicationOptions['httpsOptions'] {
  const certPath = process.env.TLS_CERT?.trim();
  const keyPath = process.env.TLS_KEY?.trim();
  if (!certPath && !keyPath) return undefined;
  if (!certPath || !keyPath || !existsSync(certPath) || !existsSync(keyPath)) {
    throw new Error('TLS_CERT 和 TLS_KEY 必须同时指向可读的证书文件');
  }
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}

function mountWeb(app: NestExpressApplication): void {
  const root = webRoot();
  const indexFile = join(root, 'index.html');
  if (!existsSync(indexFile)) {
    Logger.warn(`未找到前端页面 ${indexFile}，当前只提供 /api 和 /socket.io`, 'Bootstrap');
    return;
  }
  app.useStaticAssets(root, { index: false, fallthrough: true, redirect: false });
  app.use(
    (
      req: { method: string; path: string },
      res: { sendFile: (file: string, cb: (err: Error | null) => void) => void },
      next: (err?: unknown) => void,
    ) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const path = req.path || '/';
      if (path === '/api' || path.startsWith('/api/') || path.startsWith('/socket.io')) return next();
      if (path !== '/' && path.includes('.')) return next();
      res.sendFile(indexFile, (err) => {
        if (err) next(err);
      });
    },
  );
  Logger.log(`页面目录 ${root}`, 'Bootstrap');
}

async function bootstrap(): Promise<void> {
  const tls = tlsOptions();
  const options: NestApplicationOptions = tls ? { httpsOptions: tls } : {};
  const app = await NestFactory.create<NestExpressApplication>(AppModule, options);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  mountWeb(app);
  const port = Number(process.env.PORT || 5000);
  await app.listen(port);
  Logger.log(`${tls ? 'HTTPS' : 'HTTP'} 监听 ${port}`, 'Bootstrap');
}

void bootstrap();
