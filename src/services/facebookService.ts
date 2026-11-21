import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/env';
import type { Platform, PlatformResult, PlatformService, PublishInput } from '../types/post';
import { formBody, postForId, runPublish } from './graphRequest';

export type FacebookConfig = Pick<
  AppConfig,
  'fbPageId' | 'fbPageAccessToken' | 'metaGraphApiVersion'
>;

export class FacebookService implements PlatformService {
  readonly platform: Platform = 'facebook';

  constructor(
    private readonly config: FacebookConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  publish(input: PublishInput): Promise<PlatformResult> {
    const { fbPageId, fbPageAccessToken } = this.config;
    const problem =
      fbPageId && fbPageAccessToken
        ? undefined
        : 'Facebook credentials (FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN) are required.';

    return runPublish(this.platform, fbPageAccessToken, problem, () => this.post(input));
  }

  private async post(input: PublishInput): Promise<string> {
    const { fbPageId, fbPageAccessToken, metaGraphApiVersion } = this.config;
    const hasImage = Boolean(input.imagePath || input.imageUrl);
    const edge = hasImage ? 'photos' : 'feed';
    const url = `https://graph.facebook.com/${metaGraphApiVersion}/${encodeURIComponent(fbPageId)}/${edge}`;

    // /photos returns both `id` (the photo) and `post_id` (the Page post); prefer `post_id`.
    return postForId(this.fetchFn, this.platform, fbPageAccessToken, url, await this.body(input), [
      'post_id',
      'id',
    ]);
  }

  private async body(input: PublishInput): Promise<URLSearchParams | FormData> {
    const { text, imagePath, imageUrl, imageMimeType } = input;
    const fields = formBody({ message: text, url: imagePath ? undefined : imageUrl }, this.config.fbPageAccessToken);
    if (!imagePath) return fields;

    // /photos takes either a public `url` or the file itself as multipart `source`.
    const form = new FormData();
    fields.forEach((value, key) => form.append(key, value));
    const bytes = await fs.promises.readFile(imagePath);
    const blob = new Blob([new Uint8Array(bytes)], { type: imageMimeType ?? 'image/jpeg' });
    form.append('source', blob, path.basename(imagePath));
    return form;
  }
}
