import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ThreadsService,
  type ThreadsConfig,
  type ThreadsPollOptions,
} from '../src/services/threadsService';

const TEST_TOKEN = 'THAA-test-secret-threads-token-98765';

function createConfig(overrides: Partial<ThreadsConfig> = {}): ThreadsConfig {
  return {
    threadsUserId: 'th-555',
    threadsAccessToken: TEST_TOKEN,
    ...overrides,
  };
}

const FAST_POLL_OPTIONS: ThreadsPollOptions = {
  maxAttempts: 3,
  pollIntervalMs: 0,
  sleepFn: async () => {},
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ThreadsService', () => {
  it('publishes a text-only post via two-step flow without status polling', async () => {
    const calls: Array<{ url: string; method: string; body: URLSearchParams }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? '',
        body: init?.body as URLSearchParams,
      });

      if (calls.length === 1) {
        return jsonResponse({ id: 'th-container-101' });
      }
      return jsonResponse({ id: 'th-post-202' });
    };

    const service = new ThreadsService(
      createConfig(),
      mockFetch,
      FAST_POLL_OPTIONS
    );
    const result = await service.publish({ text: 'Hello Threads!' });

    assert.equal(calls.length, 2);

    assert.equal(calls[0].url, 'https://graph.threads.net/v1.0/th-555/threads');
    assert.equal(calls[0].method, 'POST');
    assert.ok(!calls[0].url.includes(TEST_TOKEN));
    assert.ok(calls[0].body instanceof URLSearchParams);
    assert.equal(calls[0].body.get('media_type'), 'TEXT');
    assert.equal(calls[0].body.get('text'), 'Hello Threads!');
    assert.equal(calls[0].body.get('access_token'), TEST_TOKEN);

    assert.equal(
      calls[1].url,
      'https://graph.threads.net/v1.0/th-555/threads_publish'
    );
    assert.equal(calls[1].method, 'POST');
    assert.ok(!calls[1].url.includes(TEST_TOKEN));
    assert.ok(calls[1].body instanceof URLSearchParams);
    assert.equal(calls[1].body.get('creation_id'), 'th-container-101');
    assert.equal(calls[1].body.get('access_token'), TEST_TOKEN);

    assert.deepEqual(result, {
      platform: 'threads',
      success: true,
      postId: 'th-post-202',
    });
  });

  it('publishes an image post after polling container status from IN_PROGRESS to FINISHED', async () => {
    const calls: Array<{ url: string; method: string; body?: URLSearchParams }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const method = init?.method ?? 'GET';
      calls.push({
        url: String(input),
        method,
        body: init?.body instanceof URLSearchParams ? init.body : undefined,
      });

      if (calls.length === 1) {
        return jsonResponse({ id: 'th-img-container-1' });
      }
      if (calls.length === 2) {
        return jsonResponse({ id: 'th-img-container-1', status: 'IN_PROGRESS' });
      }
      if (calls.length === 3) {
        return jsonResponse({ id: 'th-img-container-1', status: 'FINISHED' });
      }
      return jsonResponse({ id: 'th-img-post-999' });
    };

    const service = new ThreadsService(
      createConfig(),
      mockFetch,
      FAST_POLL_OPTIONS
    );
    const result = await service.publish({
      text: 'Threads image post',
      imageUrl: 'https://example.com/uploads/photo.jpg',
    });

    assert.equal(calls.length, 4);

    assert.equal(calls[0].url, 'https://graph.threads.net/v1.0/th-555/threads');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].body?.get('media_type'), 'IMAGE');
    assert.equal(
      calls[0].body?.get('image_url'),
      'https://example.com/uploads/photo.jpg'
    );
    assert.equal(calls[0].body?.get('text'), 'Threads image post');

    assert.equal(calls[1].method, 'GET');
    assert.ok(
      calls[1].url.startsWith(
        'https://graph.threads.net/v1.0/th-img-container-1?fields=status,error_message'
      )
    );
    assert.equal(calls[2].method, 'GET');

    assert.equal(
      calls[3].url,
      'https://graph.threads.net/v1.0/th-555/threads_publish'
    );
    assert.equal(calls[3].method, 'POST');
    assert.equal(calls[3].body?.get('creation_id'), 'th-img-container-1');

    assert.deepEqual(result, {
      platform: 'threads',
      success: true,
      postId: 'th-img-post-999',
    });
  });

  it('omits text parameter for image-only posts when text is empty', async () => {
    const bodies: Array<URLSearchParams | undefined> = [];

    const mockFetch: typeof fetch = async (_input, init) => {
      bodies.push(init?.body instanceof URLSearchParams ? init.body : undefined);
      if (bodies.length === 1) {
        return jsonResponse({ id: 'th-img-only-1' });
      }
      if (bodies.length === 2) {
        return jsonResponse({ id: 'th-img-only-1', status: 'FINISHED' });
      }
      return jsonResponse({ id: 'th-img-only-post' });
    };

    const service = new ThreadsService(
      createConfig(),
      mockFetch,
      FAST_POLL_OPTIONS
    );
    const result = await service.publish({
      text: '',
      imageUrl: 'https://example.com/uploads/photo.jpg',
    });

    assert.equal(bodies.length, 3);
    assert.equal(bodies[0]?.get('media_type'), 'IMAGE');
    assert.equal(bodies[0]?.has('text'), false);
    assert.deepEqual(result, {
      platform: 'threads',
      success: true,
      postId: 'th-img-only-post',
    });
  });

  it('stops before threads_publish and returns error_message when container status is ERROR', async () => {
    let callCount = 0;

    const mockFetch: typeof fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({ id: 'th-err-container' });
      }
      return jsonResponse({
        id: 'th-err-container',
        status: 'ERROR',
        error_message: 'FAILED_DOWNLOADING_IMAGE',
      });
    };

    const service = new ThreadsService(
      createConfig(),
      mockFetch,
      FAST_POLL_OPTIONS
    );
    const result = await service.publish({
      text: 'Broken image',
      imageUrl: 'https://example.com/uploads/missing.jpg',
    });

    assert.equal(callCount, 2);
    assert.equal(result.platform, 'threads');
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /FAILED_DOWNLOADING_IMAGE/);
  });

  it('stops before threads_publish and returns timeout error when container stays IN_PROGRESS', async () => {
    let callCount = 0;

    const mockFetch: typeof fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({ id: 'th-slow-container' });
      }
      return jsonResponse({
        id: 'th-slow-container',
        status: 'IN_PROGRESS',
      });
    };

    const service = new ThreadsService(
      createConfig(),
      mockFetch,
      FAST_POLL_OPTIONS
    );
    const result = await service.publish({
      text: 'Slow image',
      imageUrl: 'https://example.com/uploads/slow.jpg',
    });

    assert.equal(callCount, 4); // 1 container create + 3 status poll attempts
    assert.equal(result.platform, 'threads');
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /did not finish processing in time/i);
  });

  it('rejects imagePath without imageUrl and rejects empty text without image before calling fetch', async () => {
    let fetchCalled = false;
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true;
      return jsonResponse({ id: 'unused' });
    };

    const service = new ThreadsService(
      createConfig(),
      mockFetch,
      FAST_POLL_OPTIONS
    );

    const localOnlyResult = await service.publish({
      text: 'Image without URL',
      imagePath: '/tmp/sample.jpg',
    });
    const emptyResult = await service.publish({ text: '   ' });

    assert.equal(fetchCalled, false);
    assert.equal(localOnlyResult.success, false);
    assert.match(localOnlyResult.error ?? '', /publicly reachable image url/i);
    assert.equal(emptyResult.success, false);
    assert.match(emptyResult.error ?? '', /requires text or a publicly reachable image url/i);
  });

  it('rejects missing credentials without calling fetch', async () => {
    let fetchCalled = false;
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true;
      return jsonResponse({ id: 'unused' });
    };

    const service = new ThreadsService(
      createConfig({ threadsUserId: '', threadsAccessToken: '' }),
      mockFetch,
      FAST_POLL_OPTIONS
    );
    const result = await service.publish({ text: 'Hello' });

    assert.equal(fetchCalled, false);
    assert.equal(result.platform, 'threads');
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /credentials/i);
  });

  it('stops before Step 2 on OAuth code 190 invalid and expired token errors without leaking token', async () => {
    let invalidCalls = 0;
    const invalidFetch: typeof fetch = async () => {
      invalidCalls += 1;
      return jsonResponse(
        {
          error: {
            message: `Invalid Threads token ${TEST_TOKEN}`,
            code: 190,
          },
        },
        400
      );
    };

    const service1 = new ThreadsService(
      createConfig(),
      invalidFetch,
      FAST_POLL_OPTIONS
    );
    const invalidResult = await service1.publish({ text: 'Hello' });

    assert.equal(invalidCalls, 1);
    assert.equal(invalidResult.success, false);
    assert.ok(invalidResult.error);
    assert.ok(!invalidResult.error.includes(TEST_TOKEN));
    assert.match(invalidResult.error, /invalid or expired/i);

    let expiredCalls = 0;
    const expiredFetch: typeof fetch = async () => {
      expiredCalls += 1;
      return jsonResponse(
        {
          error: {
            message: `Expired Threads token ${TEST_TOKEN}`,
            code: 190,
            error_subcode: 463,
          },
        },
        400
      );
    };

    const service2 = new ThreadsService(
      createConfig(),
      expiredFetch,
      FAST_POLL_OPTIONS
    );
    const expiredResult = await service2.publish({ text: 'Hello' });

    assert.equal(expiredCalls, 1);
    assert.equal(expiredResult.success, false);
    assert.ok(expiredResult.error);
    assert.ok(!expiredResult.error.includes(TEST_TOKEN));
    assert.match(expiredResult.error, /has expired/i);
  });

  it('redacts token on Step 2 API error and on network error during status polling', async () => {
    let step2Calls = 0;
    const step2FailFetch: typeof fetch = async () => {
      step2Calls += 1;
      if (step2Calls === 1) {
        return jsonResponse({ id: 'th-container-step2' });
      }
      return jsonResponse(
        {
          error: {
            message: `Publish error for access_token=${TEST_TOKEN} (${TEST_TOKEN})`,
            code: 2,
          },
        },
        500
      );
    };

    const service1 = new ThreadsService(
      createConfig(),
      step2FailFetch,
      FAST_POLL_OPTIONS
    );
    const step2Result = await service1.publish({ text: 'Hello' });

    assert.equal(step2Calls, 2);
    assert.equal(step2Result.success, false);
    assert.ok(step2Result.error);
    assert.ok(!step2Result.error.includes(TEST_TOKEN));
    assert.ok(step2Result.error.includes('[REDACTED]'));
    assert.ok(step2Result.error.includes('(code 2)'));

    let pollFailCalls = 0;
    const pollNetworkFailFetch: typeof fetch = async (input) => {
      pollFailCalls += 1;
      if (pollFailCalls === 1) {
        return jsonResponse({ id: 'th-container-net' });
      }
      throw new Error(`GET ${String(input)} failed with token ${TEST_TOKEN}`);
    };

    const service2 = new ThreadsService(
      createConfig(),
      pollNetworkFailFetch,
      FAST_POLL_OPTIONS
    );
    const pollResult = await service2.publish({
      text: 'Image post',
      imageUrl: 'https://example.com/uploads/photo.jpg',
    });

    assert.equal(pollFailCalls, 2);
    assert.equal(pollResult.success, false);
    assert.ok(pollResult.error);
    assert.ok(!pollResult.error.includes(TEST_TOKEN));
    assert.ok(pollResult.error.includes('access_token=[REDACTED]'));
  });
});
