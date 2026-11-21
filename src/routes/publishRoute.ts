import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import multer from 'multer';
import { PublishOrchestrator } from '../orchestrator/publishOrchestrator';
import {
  validatePublishPayload,
  type UploadedImageInfo,
} from '../validation/postSchema';

export interface PublishRouterDeps {
  orchestrator: PublishOrchestrator;
  publicBaseUrl: string;
  uploadsDir: string;
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function safeExtension(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.bin';
}

function createUploadMiddleware(uploadsDir: string) {
  fs.mkdirSync(uploadsDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}${safeExtension(
        file.originalname
      )}`;
      cb(null, uniqueName);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_BYTES },
  }).single('image');

  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Image must be 8 MB or smaller.' });
        return;
      }

      const message =
        err instanceof Error ? err.message : 'File upload failed.';
      res.status(400).json({ error: message });
    });
  };
}

function toUploadedImageInfo(
  file: Express.Multer.File | undefined
): UploadedImageInfo | undefined {
  if (!file) {
    return undefined;
  }

  return {
    path: file.path,
    filename: file.filename,
    mimetype: file.mimetype,
    originalname: file.originalname,
  };
}

async function cleanupUploadedFile(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }

  await fs.promises.unlink(filePath).catch(() => undefined);
}

function buildPublicImageUrl(
  publicBaseUrl: string,
  filename: string
): string | undefined {
  if (!publicBaseUrl) {
    return undefined;
  }

  return `${publicBaseUrl}/uploads/${encodeURIComponent(filename)}`;
}

export function createPublishRouter(deps: PublishRouterDeps): Router {
  const router = Router();
  const handleUpload = createUploadMiddleware(deps.uploadsDir);

  router.post(
    '/publish',
    handleUpload,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const fileInfo = toUploadedImageInfo(req.file);

      try {
        const validation = validatePublishPayload(req.body, fileInfo);
        if (!validation.ok) {
          await cleanupUploadedFile(fileInfo?.path);
          res.status(400).json({
            error: validation.errors[0],
            errors: validation.errors,
          });
          return;
        }

        const imageUrl = fileInfo
          ? buildPublicImageUrl(deps.publicBaseUrl, fileInfo.filename)
          : undefined;

        const results = await deps.orchestrator.publish({
          text: validation.data.text,
          platforms: validation.data.platforms,
          imagePath: fileInfo?.path,
          imageUrl,
          imageMimeType: fileInfo?.mimetype,
        });

        res.status(200).json({ results });
      } catch (err: unknown) {
        await cleanupUploadedFile(fileInfo?.path);
        next(err);
      }
    }
  );

  return router;
}
