import type { AppConfig } from '../config/env';
import type { Platform, PlatformResult, PlatformService, PublishInput } from '../types/post';
import { formBody, postForId, runPublish, sendJson } from './graphRequest';
import { isRecord } from './metaError';

export type ThreadsConfig = Pick<AppConfig, 'threadsUserId' | 'threadsAccessToken'>;

export interface ThreadsPollOptions {
  maxAttempts?: number;
  pollIntervalMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

// Threads has its own host and version, and its own token (not the Facebook one).
const THREADS_API = 'https://graph.threads.net/v1.0';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ThreadsService implements PlatformService {
  readonly platform: Platform = 'threads';
  private readonly maxAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    private readonly config: ThreadsConfig,
    private readonly fetchFn: typeof fetch = fetch,
    { maxAttempts = 10, pollIntervalMs = 2000, sleepFn = sleep }: ThreadsPollOptions = {}
  ) {
    this.maxAttempts = maxAttempts;
    this.pollIntervalMs = pollIntervalMs;
    this.sleepFn = sleepFn;
  }

  publish(input: PublishInput): Promise<PlatformResult> {
    return runPublish(this.platform, this.config.threadsAccessToken, this.problemWith(input), () =>
      this.post(input)
    );
  }

  private problemWith(input: PublishInput): string | undefined {
    if (!this.config.threadsUserId || !this.config.threadsAccessToken) {
      return 'Threads credentials (THREADS_USER_ID and THREADS_ACCESS_TOKEN) are required.';
    }
    if (input.imagePath && !input.imageUrl) {
      return 'Threads image posts require a publicly reachable image URL.';
    }
    if (!input.imageUrl && !input.text.trim()) {
      return 'Threads requires text or a publicly reachable image URL.';
    }
    return undefined;
  }

  // Two steps: create a container, then publish it.
  private async post({ text, imageUrl }: PublishInput): Promise<string> {
    const containerId = await this.send(
      'threads',
      imageUrl
        ? { media_type: 'IMAGE', image_url: imageUrl, text }
        : { media_type: 'TEXT', text }
    );

    // For IMAGE containers Meta downloads the image in the background, so wait for it.
    if (imageUrl) await this.waitUntilReady(containerId);

    return this.send('threads_publish', { creation_id: containerId });
  }

  private send(edge: 'threads' | 'threads_publish', fields: Record<string, string | undefined>) {
    const { threadsUserId, threadsAccessToken } = this.config;
    const url = `${THREADS_API}/${encodeURIComponent(threadsUserId)}/${edge}`;
    const body = formBody(fields, threadsAccessToken);
    return postForId(this.fetchFn, this.platform, threadsAccessToken, url, body);
  }

  private async waitUntilReady(containerId: string): Promise<void> {
    const token = this.config.threadsAccessToken;
    // Threads documents the token as a query parameter on GET requests.
    const url = `${THREADS_API}/${encodeURIComponent(containerId)}?fields=status,error_message&access_token=${encodeURIComponent(token)}`;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const reply = await sendJson(this.fetchFn, this.platform, token, url, { method: 'GET' });
      const { status, error_message: reason } = isRecord(reply) ? reply : ({} as Record<string, unknown>);

      if (status === 'FINISHED' || status === 'PUBLISHED') return;
      if (status === 'ERROR') {
        throw new Error(
          reason ? `Threads media container failed: ${reason}` : 'Threads media container processing failed.'
        );
      }
      if (status === 'EXPIRED') {
        throw new Error('Threads media container expired before it could be published.');
      }

      if (attempt < this.maxAttempts) await this.sleepFn(this.pollIntervalMs);
    }

    throw new Error('Threads media container did not finish processing in time.');
  }
}
