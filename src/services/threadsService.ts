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

export type ThreadsConfig = Pick<
  AppConfig,
  'threadsUserId' | 'threadsAccessToken'
>;

export interface ThreadsPollOptions {
  maxAttempts?: number;
  pollIntervalMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

// Threads uses its own API host and v1.0 version, separate from Facebook/Instagram Graph API.
const THREADS_API_BASE_URL = 'https://graph.threads.net/v1.0';
const PLATFORM_LABEL = 'Threads';
const DEFAULT_MAX_POLL_ATTEMPTS = 10;
const DEFAULT_POLL_INTERVAL_MS = 2000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractId(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  if (typeof body.id === 'string' && body.id.trim().length > 0) {
    return body.id;
  }

  return undefined;
}

function extractContainerStatus(body: unknown): {
  status?: string;
  errorMessage?: string;
} {
  if (!isRecord(body)) {
    return {};
  }

  const status =
    typeof body.status === 'string' ? body.status.trim() : undefined;
  const errorMessage =
    typeof body.error_message === 'string' && body.error_message.trim().length > 0
      ? body.error_message.trim()
      : undefined;

  return { status, errorMessage };
}

export class ThreadsService implements PlatformService {
  readonly platform: Platform = 'threads';
  private readonly maxAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    private readonly config: ThreadsConfig,
    private readonly fetchFn: typeof fetch = fetch,
    pollOptions: ThreadsPollOptions = {}
  ) {
    this.maxAttempts = pollOptions.maxAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
    this.pollIntervalMs =
      pollOptions.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.sleepFn = pollOptions.sleepFn ?? defaultSleep;
  }

  async publish(input: PublishInput): Promise<PlatformResult> {
    if (!this.config.threadsUserId || !this.config.threadsAccessToken) {
      return {
        platform: this.platform,
        success: false,
        error:
          'Threads credentials (THREADS_USER_ID and THREADS_ACCESS_TOKEN) are required.',
      };
    }

    if (input.imagePath && !input.imageUrl) {
      return {
        platform: this.platform,
        success: false,
        error: 'Threads image posts require a publicly reachable image URL.',
      };
    }

    if (!input.imageUrl && input.text.trim().length === 0) {
      return {
        platform: this.platform,
        success: false,
        error: 'Threads requires text or a publicly reachable image URL.',
      };
    }

    try {
      const creationId = await this.createContainer(input);

      // Meta downloads image_url asynchronously for IMAGE containers; poll until FINISHED before publishing.
      if (input.imageUrl) {
        await this.waitForContainerReady(creationId);
      }

      const postId = await this.publishContainer(creationId);

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
          this.config.threadsAccessToken,
        ]),
      };
    }
  }

  private buildUserEndpointUrl(edge: 'threads' | 'threads_publish'): string {
    const userId = encodeURIComponent(this.config.threadsUserId);
    return `${THREADS_API_BASE_URL}/${userId}/${edge}`;
  }

  private async createContainer(input: PublishInput): Promise<string> {
    const url = this.buildUserEndpointUrl('threads');
    const body = new URLSearchParams({
      access_token: this.config.threadsAccessToken,
    });

    if (input.imageUrl) {
      body.set('media_type', 'IMAGE');
      body.set('image_url', input.imageUrl);
      if (input.text.length > 0) {
        body.set('text', input.text);
      }
    } else {
      body.set('media_type', 'TEXT');
      body.set('text', input.text);
    }

    return this.sendPostRequest(url, body, 'container creation');
  }

  private async waitForContainerReady(creationId: string): Promise<void> {
    const containerId = encodeURIComponent(creationId);
    // Meta's Threads API docs pass access_token as a query parameter on GET container status requests.
    const statusUrl =
      `${THREADS_API_BASE_URL}/${containerId}` +
      `?fields=status,error_message&access_token=${encodeURIComponent(this.config.threadsAccessToken)}`;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const response = await this.fetchFn(statusUrl, { method: 'GET' });
      const payload = await safeParseJson(response);

      if (!response.ok) {
        throw new Error(
          parseMetaError(response.status, payload, PLATFORM_LABEL, [
            this.config.threadsAccessToken,
          ])
        );
      }

      const { status, errorMessage } = extractContainerStatus(payload);
      if (status === 'FINISHED' || status === 'PUBLISHED') {
        return;
      }

      if (status === 'ERROR') {
        throw new Error(
          errorMessage
            ? `Threads media container failed: ${errorMessage}`
            : 'Threads media container processing failed.'
        );
      }

      if (status === 'EXPIRED') {
        throw new Error(
          'Threads media container expired before it could be published.'
        );
      }

      if (attempt < this.maxAttempts) {
        await this.sleepFn(this.pollIntervalMs);
      }
    }

    throw new Error(
      'Threads media container did not finish processing in time.'
    );
  }

  private async publishContainer(creationId: string): Promise<string> {
    const url = this.buildUserEndpointUrl('threads_publish');
    const body = new URLSearchParams({
      creation_id: creationId,
      access_token: this.config.threadsAccessToken,
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
          this.config.threadsAccessToken,
        ])
      );
    }

    const id = extractId(payload);
    if (!id) {
      throw new Error(
        `Threads API ${stepLabel} succeeded but did not return an ID.`
      );
    }

    return id;
  }
}
