import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { loadConfig, type AppConfig } from './config/env';
import { PublishOrchestrator } from './orchestrator/publishOrchestrator';
import { createPublishRouter } from './routes/publishRoute';
import { FacebookService } from './services/facebookService';
import { InstagramService } from './services/instagramService';
import { ThreadsService } from './services/threadsService';
import type { Platform, PlatformService } from './types/post';

export interface CreateAppOptions {
  config?: AppConfig;
  services?: Record<Platform, PlatformService>; // Tests pass fakes here.
  uploadsDir?: string;
}

// Never send the real error to the browser: it could contain internal details.
const sendServerError: ErrorRequestHandler = (_err, _req, res, _next) => {
  res.status(500).json({ error: 'Internal server error.' });
};

export function createApp(options: CreateAppOptions = {}): express.Express {
  const config = options.config ?? loadConfig();
  const uploadsDir = options.uploadsDir ?? path.resolve('uploads');
  const services = options.services ?? {
    facebook: new FacebookService(config),
    instagram: new InstagramService(config),
    threads: new ThreadsService(config),
  };

  const app = express();

  // Instagram and Threads download the image from this public URL.
  app.use('/uploads', express.static(uploadsDir));
  app.use(
    '/api',
    createPublishRouter({
      orchestrator: new PublishOrchestrator(services),
      publicBaseUrl: config.publicBaseUrl,
      uploadsDir,
    })
  );
  app.use(express.static(path.resolve('public')));
  app.use(sendServerError);

  return app;
}

// Start the server only when run directly (`npm start`), not when tests import this file.
if (require.main === module) {
  const { port } = loadConfig();
  createApp().listen(port, () => console.log(`Social media publisher running at http://localhost:${port}`));
}
