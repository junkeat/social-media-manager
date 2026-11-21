export type Platform = 'facebook' | 'instagram' | 'threads';

export const ALL_PLATFORMS: readonly Platform[] = [
  'facebook',
  'instagram',
  'threads',
] as const;

export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  // Meta's Graph API reference does not specify a hard numeric ceiling for Page post `message`;
  // enforcing Facebook's standard 63,206-character post limit.
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

export interface PlatformResult {
  platform: Platform;
  success: boolean;
  postId?: string;
  error?: string;
}

export interface PublishRequest {
  text: string;
  platforms: Platform[];
  imagePath?: string;
  imageUrl?: string;
  imageMimeType?: string;
}

export interface PlatformService {
  readonly platform: Platform;
  publish(input: PublishInput): Promise<PlatformResult>;
}
