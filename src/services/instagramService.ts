import type { AppConfig } from '../config/env';
import type {
  Platform,
  PlatformResult,
  PlatformService,
  PublishInput,
} from '../types/post';
import {
  formatUnexpectedError,
  isRecord,
  parseMetaError,
  safeParseJson,
} from './metaError';

export type InstagramConfig = Pick<
  AppConfig,
  'igBusinessAccountId' | 'fbPageAccessToken' | 'metaGraphApiVersion'
>;

const FACEBOOK_GRAPH_BASE_URL = 'https://graph.facebook.com';
const PLATFORM_LABEL = 'Instagram';

function extractId(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  if (typeof body.id === 'string' && body.id.trim().length > 0) {
    return body.id;
  }

  return undefined;
}

export class InstagramService implements PlatformService {
  readonly platform: Platform = 'instagram';

  constructor(
    private readonly config: InstagramConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async publish(input: PublishInput): Promise<PlatformResult> {
    if (!this.config.igBusinessAccountId || !this.config.fbPageAccessToken) {
      return {
        platform: this.platform,
        success: false,
        error:
          'Instagram credentials (IG_BUSINESS_ACCOUNT_ID and FB_PAGE_ACCESS_TOKEN) are required.',
      };
    }

    if (!input.imageUrl) {
      return {
        platform: this.platform,
        success: false,
        error: 'Instagram requires a publicly reachable image URL.',
      };
    }

    // Instagram Graph API Content Publishing only supports JPEG images for single image posts.
    if (
      input.imageMimeType &&
      input.imageMimeType.toLowerCase() !== 'image/jpeg'
    ) {
      return {
        platform: this.platform,
        success: false,
        error: 'Instagram only accepts JPEG images.',
      };
    }

    try {
      const creationId = await this.createMediaContainer(
        input.imageUrl,
        input.text
      );
      const postId = await this.publishMediaContainer(creationId);

      return {
        platform: this.platform,
        success: true,
        postId,
      };
    } catch (err: unknown) {
      return {
        platform: this.platform,
        success: false,
        error: formatUnexpectedError(err, PLATFORM_LABEL, [
          this.config.fbPageAccessToken,
        ]),
      };
    }
  }

  private buildEndpointUrl(edge: 'media' | 'media_publish'): string {
    const version = encodeURIComponent(this.config.metaGraphApiVersion);
    const accountId = encodeURIComponent(this.config.igBusinessAccountId);
    return `${FACEBOOK_GRAPH_BASE_URL}/${version}/${accountId}/${edge}`;
  }

  // Step 1 of Instagram Graph API publishing: create a media container from a public JPEG URL.
  private async createMediaContainer(
    imageUrl: string,
    caption: string
  ): Promise<string> {
    const url = this.buildEndpointUrl('media');
    const body = new URLSearchParams({
      image_url: imageUrl,
      access_token: this.config.fbPageAccessToken,
    });

    if (caption.length > 0) {
      body.set('caption', caption);
    }

    return this.sendPostRequest(url, body, 'container creation');
  }

  // Step 2: publish the created container. Single JPEG images publish directly without video status polling.
  private async publishMediaContainer(creationId: string): Promise<string> {
    const url = this.buildEndpointUrl('media_publish');
    const body = new URLSearchParams({
      creation_id: creationId,
      access_token: this.config.fbPageAccessToken,
    });

    return this.sendPostRequest(url, body, 'container publish');
  }

  private async sendPostRequest(
    url: string,
    body: URLSearchParams,
    stepLabel: string
  ): Promise<string> {
    const response = await this.fetchFn(url, {
      method: 'POST',
      body,
    });
    const payload = await safeParseJson(response);

    if (!response.ok) {
      throw new Error(
        parseMetaError(response.status, payload, PLATFORM_LABEL, [
          this.config.fbPageAccessToken,
        ])
      );
    }

    const id = extractId(payload);
    if (!id) {
      throw new Error(
        `Instagram API ${stepLabel} succeeded but did not return an ID.`
      );
    }

    return id;
  }
}
