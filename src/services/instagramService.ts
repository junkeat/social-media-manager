import type { AppConfig } from '../config/env';
import type { Platform, PlatformResult, PlatformService, PublishInput } from '../types/post';
import { formBody, postForId, runPublish } from './graphRequest';

export type InstagramConfig = Pick<
  AppConfig,
  'igBusinessAccountId' | 'fbPageAccessToken' | 'metaGraphApiVersion'
>;

export class InstagramService implements PlatformService {
  readonly platform: Platform = 'instagram';

  constructor(
    private readonly config: InstagramConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  publish(input: PublishInput): Promise<PlatformResult> {
    return runPublish(this.platform, this.config.fbPageAccessToken, this.problemWith(input), () =>
      this.post(input)
    );
  }

  private problemWith(input: PublishInput): string | undefined {
    if (!this.config.igBusinessAccountId || !this.config.fbPageAccessToken) {
      return 'Instagram credentials (IG_BUSINESS_ACCOUNT_ID and FB_PAGE_ACCESS_TOKEN) are required.';
    }
    // Instagram fetches the image itself, so it needs a public URL.
    if (!input.imageUrl) return 'Instagram requires a publicly reachable image URL.';
    // Instagram only accepts JPEG images.
    if (input.imageMimeType && input.imageMimeType.toLowerCase() !== 'image/jpeg') {
      return 'Instagram only accepts JPEG images.';
    }
    return undefined;
  }

  // Two steps: create a media container, then publish it.
  private async post({ text, imageUrl }: PublishInput): Promise<string> {
    const creationId = await this.send('media', { image_url: imageUrl, caption: text });
    return this.send('media_publish', { creation_id: creationId });
  }

  private send(edge: 'media' | 'media_publish', fields: Record<string, string | undefined>) {
    const { igBusinessAccountId, fbPageAccessToken, metaGraphApiVersion } = this.config;
    const url = `https://graph.facebook.com/${metaGraphApiVersion}/${encodeURIComponent(igBusinessAccountId)}/${edge}`;
    const body = formBody(fields, fbPageAccessToken);
    return postForId(this.fetchFn, this.platform, fbPageAccessToken, url, body);
  }
}
