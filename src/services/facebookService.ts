import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/env';
import type { Platform, PlatformResult, PlatformService, PublishInput } from '../types/post';
import {
  formatUnexpectedError,
  isRecord,
  parseMetaError,
  safeParseJson,
} from './metaError';

export type FacebookConfig = Pick<
  AppConfig,
  'fbPageId' | 'fbPageAccessToken' | 'metaGraphApiVersion'
>;

const FACEBOOK_GRAPH_BASE_URL = 'https://graph.facebook.com';
const PLATFORM_LABEL = 'Facebook';

function extractFacebookPostId(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  // /{page-id}/photos returns both `id` (photo) and `post_id` (feed post); prefer `post_id`.
  if (typeof body.post_id === 'string' && body.post_id.trim().length > 0) {
    return body.post_id;
  }

  if (typeof body.id === 'string' && body.id.trim().length > 0) {
    return body.id;
  }

  return undefined;
}

export class FacebookService implements PlatformService {
  readonly platform: Platform = 'facebook';

  constructor(
    private readonly config: FacebookConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async publish(input: PublishInput): Promise<PlatformResult> {
    if (!this.config.fbPageId || !this.config.fbPageAccessToken) {
      return {
        platform: this.platform,
        success: false,
        error: 'Facebook credentials (FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN) are required.',
      };
    }

    try {
      const postId =
        input.imagePath || input.imageUrl
          ? await this.publishPhotoPost(input)
          : await this.publishTextPost(input.text);

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

  private buildEndpointUrl(edge: 'feed' | 'photos'): string {
    const version = encodeURIComponent(this.config.metaGraphApiVersion);
    const pageId = encodeURIComponent(this.config.fbPageId);
    return `${FACEBOOK_GRAPH_BASE_URL}/${version}/${pageId}/${edge}`;
  }

  private async publishTextPost(text: string): Promise<string> {
    const url = this.buildEndpointUrl('feed');
    const body = new URLSearchParams({
      message: text,
      access_token: this.config.fbPageAccessToken,
    });

    return this.sendPostRequest(url, body);
  }

  // Facebook /{page-id}/photos accepts binary upload (`source`) or public `url`
  // and returns both `id` (photo ID) and `post_id` (Page feed post ID).
  private async publishPhotoPost(input: PublishInput): Promise<string> {
    const url = this.buildEndpointUrl('photos');
    const body = input.imagePath
      ? await this.buildPhotoFormData(input.imagePath, input.text, input.imageMimeType)
      : this.buildPhotoUrlParams(input.imageUrl ?? '', input.text);

    return this.sendPostRequest(url, body);
  }

  private async buildPhotoFormData(
    imagePath: string,
    text: string,
    imageMimeType?: string
  ): Promise<FormData> {
    const fileBuffer = await fs.promises.readFile(imagePath);
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], {
      type: imageMimeType ?? 'image/jpeg',
    });

    formData.append('source', blob, path.basename(imagePath));
    if (text.length > 0) {
      formData.append('message', text);
    }
    formData.append('access_token', this.config.fbPageAccessToken);

    return formData;
  }

  private buildPhotoUrlParams(imageUrl: string, text: string): URLSearchParams {
    const params = new URLSearchParams({
      url: imageUrl,
      access_token: this.config.fbPageAccessToken,
    });

    if (text.length > 0) {
      params.set('message', text);
    }

    return params;
  }

  private async sendPostRequest(
    url: string,
    body: URLSearchParams | FormData
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

    const postId = extractFacebookPostId(payload);
    if (!postId) {
      throw new Error('Facebook API succeeded but did not return a post ID.');
    }

    return postId;
  }
}
