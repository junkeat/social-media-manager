export type Platform = 'facebook' | 'instagram' | 'threads';

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
};

export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  // Meta's Graph API reference gives no numeric limit for Page post `message`;
  // we enforce Facebook's standard 63,206-character post limit.
  facebook: 63206,
  instagram: 2200,
  threads: 500,
};

export interface PublishInput {
  text: string;
  imagePath?: string;
  imageUrl?: string;
  imageMimeType?: string;
}

export type PublishRequest = PublishInput & { platforms: Platform[] };

export interface PlatformResult {
  platform: Platform;
  success: boolean;
  postId?: string;
  error?: string;
}

export interface PlatformService {
  readonly platform: Platform;
  publish(input: PublishInput): Promise<PlatformResult>;
}
