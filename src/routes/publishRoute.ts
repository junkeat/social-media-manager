import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import type { PublishOrchestrator } from '../orchestrator/publishOrchestrator';
import { validatePublishPayload } from '../validation/postSchema';

export interface PublishRouterDeps {
  orchestrator: PublishOrchestrator;
  publicBaseUrl: string;
  uploadsDir: string;
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// Keep only a plain extension from the user's file name.
function safeExtension(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.bin';
}

function removeFile(filePath?: string): Promise<void> {
  return filePath ? fs.promises.unlink(filePath).catch(() => undefined) : Promise.resolve();
}

/** Runs multer and answers upload errors (such as a file that is too large) with a 400. */
function acceptImageUpload(uploadsDir: string): RequestHandler {
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (_req, file, cb) =>
        cb(null, `${Date.now()}-${crypto.randomUUID()}${safeExtension(file.originalname)}`),
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES },
  }).single('image');

  return (req, res, next) => {
    upload(req, res, (err: unknown) => {
      if (!err) return next();

      const tooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      res.status(400).json({ error: tooLarge ? 'Image must be 8 MB or smaller.' : 'File upload failed.' });
    });
  };
}

export function createPublishRouter({ orchestrator, publicBaseUrl, uploadsDir }: PublishRouterDeps): Router {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const router = Router();

  router.post(
    '/publish',
    acceptImageUpload(uploadsDir),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const file = req.file;

      try {
        const validation = validatePublishPayload(req.body, file);
        if (!validation.ok) {
          await removeFile(file?.path);
          res.status(400).json({ error: validation.errors[0], errors: validation.errors });
          return;
        }

        // Instagram and Threads fetch the image from this public URL.
        const imageUrl =
          file && publicBaseUrl
            ? `${publicBaseUrl}/uploads/${encodeURIComponent(file.filename)}`
            : undefined;

        const results = await orchestrator.publish({
          ...validation.data,
          imagePath: file?.path,
          imageUrl,
          imageMimeType: file?.mimetype,
        });
        res.json({ results });
      } catch (err: unknown) {
        await removeFile(file?.path);
        next(err);
      }
    }
  );

  return router;
}
