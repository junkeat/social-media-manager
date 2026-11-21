import fs from 'node:fs';
import path from 'node:path';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { loadConfig, type AppConfig } from './config/env';
import { PublishOrchestrator } from './orchestrator/publishOrchestrator';
import { createPublishRouter } from './routes/publishRoute';
import { FacebookService } from './services/facebookService';
import { InstagramService } from './services/instagramService';
import { ThreadsService } from './services/threadsService';
import type { Platform, PlatformService } from './types/post';

export interface CreateAppOptions {
  config?: AppConfig;
  services?: Record<Platform, PlatformService>;
  uploadsDir?: string;
  publicDir?: string;
}

function createDefaultServices(
  config: AppConfig
): Record<Platform, PlatformService> {
  return {
    facebook: new FacebookService(config),
    instagram: new InstagramService(config),
    threads: new ThreadsService(config),
  };
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const config = options.config ?? loadConfig();
  const services = options.services ?? createDefaultServices(config);
  const uploadsDir =
    options.uploadsDir ?? path.resolve(process.cwd(), 'uploads');
  const publicDir = options.publicDir ?? path.resolve(process.cwd(), 'public');

  fs.mkdirSync(uploadsDir, { recursive: true });

  const app = express();

  // Serve uploaded images publicly so Instagram and Threads can fetch them by URL.
  app.use('/uploads', express.static(uploadsDir));

  app.use(
    '/api',
    createPublishRouter({
      orchestrator: new PublishOrchestrator(services),
      publicBaseUrl: config.publicBaseUrl,
      uploadsDir,
    })
  );

  app.use(express.static(publicDir));

  app.use(
    (
      _err: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction
    ): void => {
      res.status(500).json({ error: 'Internal server error.' });
    }
  );

  return app;
}

if (require.main === module) {
  const config = loadConfig();
  const app = createApp({ config });
  app.listen(config.port, () => {
    console.log(`Social media publisher running at http://localhost:${config.port}`);
  });
}
