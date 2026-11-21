import path from 'node:path';
import { z } from 'zod';
import { PLATFORM_CHAR_LIMITS, PLATFORM_LABELS, type Platform } from '../types/post';

export interface UploadedImageInfo {
  mimetype: string;
  originalname: string;
}

export type ValidationResult =
  | { ok: true; data: { text: string; platforms: Platform[] } }
  | { ok: false; errors: string[] };

// A form sends one `platforms` field per checked box: nothing, a string, or an array.
const toArray = (raw: unknown): unknown => (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]);

const bodySchema = z.object({
  text: z.string().default(''),
  platforms: z.preprocess(
    toArray,
    z.array(z.enum(['facebook', 'instagram', 'threads'])).min(1, 'Select at least one platform.')
  ),
});

function isJpeg({ mimetype, originalname }: UploadedImageInfo): boolean {
  const ext = path.extname(originalname).toLowerCase();
  return mimetype.toLowerCase() === 'image/jpeg' && (ext === '.jpg' || ext === '.jpeg');
}

function imageErrors(platforms: Platform[], file?: UploadedImageInfo): string[] {
  if (!platforms.includes('instagram')) return [];
  if (!file) return ['Instagram requires an image. Attach a JPEG image or uncheck Instagram.'];
  return isJpeg(file) ? [] : ['Instagram only accepts JPEG images (.jpg or .jpeg).'];
}

function lengthErrors(platforms: Platform[], text: string): string[] {
  return platforms
    .filter((platform) => text.length > PLATFORM_CHAR_LIMITS[platform])
    .map(
      (platform) =>
        `Text exceeds the ${PLATFORM_LABELS[platform]} limit of ${PLATFORM_CHAR_LIMITS[platform]} characters (currently ${text.length}).`
    );
}

export function validatePublishPayload(body: unknown, file?: UploadedImageInfo): ValidationResult {
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const { text } = parsed.data;
  const platforms = [...new Set(parsed.data.platforms)];
  const errors = [
    ...(!file && !text.trim() ? ['Enter post text or attach an image.'] : []),
    ...imageErrors(platforms, file),
    ...lengthErrors(platforms, text),
  ];

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data: { text, platforms } };
}
