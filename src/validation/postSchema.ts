import path from 'node:path';
import { z } from 'zod';
import { isRecord } from '../services/metaError';
import { PLATFORM_CHAR_LIMITS, type Platform } from '../types/post';

export interface UploadedImageInfo {
  path: string;
  filename: string;
  mimetype: string;
  originalname: string;
}

export type ValidationResult =
  | { ok: true; data: { text: string; platforms: Platform[] } }
  | { ok: false; errors: string[] };

const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
};

function deduplicateStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const rawItem of values) {
    const item = rawItem.trim();
    if (item.length > 0 && !seen.has(item)) {
      seen.add(item);
      unique.push(item);
    }
  }

  return unique;
}

function normalizePlatforms(raw: unknown): unknown {
  if (raw === undefined || raw === null) {
    return [];
  }

  if (Array.isArray(raw)) {
    const stringItems = raw.filter(
      (item): item is string => typeof item === 'string'
    );
    return stringItems.length === raw.length
      ? deduplicateStrings(stringItems)
      : raw;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return [];
    }

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return normalizePlatforms(parsed);
        }
      } catch {
        return raw;
      }
    }

    return deduplicateStrings(trimmed.split(','));
  }

  return raw;
}

function isJpegFile(file: UploadedImageInfo): boolean {
  const mime = file.mimetype.toLowerCase();
  const ext = path.extname(file.originalname).toLowerCase();
  return mime === 'image/jpeg' && (ext === '.jpg' || ext === '.jpeg');
}

const publishBodySchema = z.object({
  text: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()),
  platforms: z.preprocess(
    normalizePlatforms,
    z
      .array(z.enum(['facebook', 'instagram', 'threads']))
      .min(1, 'Select at least one platform.')
  ),
});

export function validatePublishPayload(
  body: unknown,
  file?: UploadedImageInfo
): ValidationResult {
  const safeBody = isRecord(body) ? body : {};
  const parsed = publishBodySchema.safeParse(safeBody);

  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const { text, platforms } = parsed.data;
  const errors: string[] = [];

  if (!file && text.trim().length === 0) {
    errors.push('Enter post text or attach an image.');
  }

  if (platforms.includes('instagram')) {
    if (!file) {
      errors.push(
        'Instagram requires an image. Attach a JPEG image or uncheck Instagram.'
      );
    } else if (!isJpegFile(file)) {
      errors.push('Instagram only accepts JPEG images (.jpg or .jpeg).');
    }
  }

  for (const platform of platforms) {
    const limit = PLATFORM_CHAR_LIMITS[platform];
    if (text.length > limit) {
      errors.push(
        `Text exceeds the ${PLATFORM_LABELS[platform]} limit of ${limit} characters (currently ${text.length}).`
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: { text, platforms },
  };
}
