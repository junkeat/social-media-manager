import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  InstagramService,
  type InstagramConfig,
} from '../src/services/instagramService';

const TEST_TOKEN = 'EAAG-test-secret-ig-token-67890';

function createConfig(overrides: Partial<InstagramConfig> = {}): InstagramConfig {
  return {
    igBusinessAccountId: 'ig-999',
    fbPageAccessToken: TEST_TOKEN,
    metaGraphApiVersion: 'v22.0',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('InstagramService', () => {
  it('completes two-step publish with image_url, caption, and token in POST body', async () => {
    const calls: Array<{ url: string; method: string; body: URLSearchParams }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const body = init?.body as URLSearchParams;
      calls.push({
        url: String(input),
        method: init?.method ?? '',
        body,
      });

      if (calls.length === 1) {
        return jsonResponse({ id: 'container-123' });
      }
      return jsonResponse({ id: 'ig-post-456' });
    };

    const service = new InstagramService(createConfig(), mockFetch);
    const result = await service.publish({
      text: 'Instagram launch photo',
      imageUrl: 'https://example.com/uploads/photo.jpg',
      imageMimeType: 'image/jpeg',
    });

    assert.equal(calls.length, 2);

    assert.equal(calls[0].url, 'https://graph.facebook.com/v22.0/ig-999/media');
    assert.equal(calls[0].method, 'POST');
    assert.ok(!calls[0].url.includes(TEST_TOKEN));
    assert.ok(calls[0].body instanceof URLSearchParams);
    assert.equal(
      calls[0].body.get('image_url'),
      'https://example.com/uploads/photo.jpg'
    );
    assert.equal(calls[0].body.get('caption'), 'Instagram launch photo');
    assert.equal(calls[0].body.get('access_token'), TEST_TOKEN);

    assert.equal(
      calls[1].url,
      'https://graph.facebook.com/v22.0/ig-999/media_publish'
    );
    assert.equal(calls[1].method, 'POST');
    assert.ok(!calls[1].url.includes(TEST_TOKEN));
    assert.ok(calls[1].body instanceof URLSearchParams);
    assert.equal(calls[1].body.get('creation_id'), 'container-123');
    assert.equal(calls[1].body.get('access_token'), TEST_TOKEN);

    assert.deepEqual(result, {
      platform: 'instagram',
      success: true,
      postId: 'ig-post-456',
    });
  });

  it('omits caption when text is empty and completes both steps', async () => {
    const capturedBodies: URLSearchParams[] = [];

    const mockFetch: typeof fetch = async (_input, init) => {
      capturedBodies.push(init?.body as URLSearchParams);
      if (capturedBodies.length === 1) {
        return jsonResponse({ id: 'container-empty-cap' });
      }
      return jsonResponse({ id: 'ig-post-empty-cap' });
    };

    const service = new InstagramService(createConfig(), mockFetch);
    const result = await service.publish({
      text: '',
      imageUrl: 'https://example.com/uploads/photo.jpg',
    });

    assert.equal(capturedBodies.length, 2);
    assert.equal(capturedBodies[0].has('caption'), false);
    assert.deepEqual(result, {
      platform: 'instagram',
      success: true,
      postId: 'ig-post-empty-cap',
    });
  });

  it('rejects request with no imageUrl without calling fetch', async () => {
    let fetchCalled = false;
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true;
      return jsonResponse({ id: 'unused' });
    };

    const service = new InstagramService(createConfig(), mockFetch);
    const result = await service.publish({ text: 'Text only' });

    assert.equal(fetchCalled, false);
    assert.equal(result.platform, 'instagram');
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /image url/i);
  });

  it('rejects non-JPEG imageMimeType without calling fetch', async () => {
    let fetchCalled = false;
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true;
      return jsonResponse({ id: 'unused' });
    };

    const service = new InstagramService(createConfig(), mockFetch);
    const result = await service.publish({
      text: 'PNG upload',
      imageUrl: 'https://example.com/uploads/photo.png',
      imageMimeType: 'image/png',
    });

    assert.equal(fetchCalled, false);
    assert.equal(result.platform, 'instagram');
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /jpeg/i);
  });

  it('rejects missing credentials without calling fetch', async () => {
    let fetchCalled = false;
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true;
      return jsonResponse({ id: 'unused' });
    };

    const service = new InstagramService(
      createConfig({ igBusinessAccountId: '', fbPageAccessToken: '' }),
      mockFetch
    );
    const result = await service.publish({
      text: 'Hello',
      imageUrl: 'https://example.com/uploads/photo.jpg',
    });

    assert.equal(fetchCalled, false);
    assert.equal(result.platform, 'instagram');
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /credentials/i);
  });

  it('stops before Step 2 on OAuth code 190 invalid and expired token errors without leaking token', async () => {
    let callCount = 0;
    const invalidTokenFetch: typeof fetch = async () => {
      callCount += 1;
      return jsonResponse(
        {
          error: {
            message: `Invalid OAuth token ${TEST_TOKEN}`,
            code: 190,
          },
        },
        400
      );
    };

    const service1 = new InstagramService(createConfig(), invalidTokenFetch);
    const invalidResult = await service1.publish({
      text: 'Test',
      imageUrl: 'https://example.com/uploads/photo.jpg',
    });

    assert.equal(callCount, 1);
    assert.equal(invalidResult.success, false);
    assert.ok(invalidResult.error);
    assert.ok(!invalidResult.error.includes(TEST_TOKEN));
    assert.match(invalidResult.error, /invalid or expired/i);

    let expiredCallCount = 0;
    const expiredTokenFetch: typeof fetch = async () => {
      expiredCallCount += 1;
      return jsonResponse(
        {
          error: {
            message: `Session expired for ${TEST_TOKEN}`,
            code: 190,
            error_subcode: 463,
          },
        },
        400
      );
    };

    const service2 = new InstagramService(createConfig(), expiredTokenFetch);
    const expiredResult = await service2.publish({
      text: 'Test',
      imageUrl: 'https://example.com/uploads/photo.jpg',
    });

    assert.equal(expiredCallCount, 1);
    assert.equal(expiredResult.success, false);
    assert.ok(expiredResult.error);
    assert.ok(!expiredResult.error.includes(TEST_TOKEN));
    assert.match(expiredResult.error, /has expired/i);
  });

  it('returns redacted error message including code on Step 2 Graph API failure', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({ id: 'container-123' });
      }
      return jsonResponse(
        {
          error: {
            message: `Media publish rejected for access_token=${TEST_TOKEN} (${TEST_TOKEN})`,
            code: 9007,
          },
        },
        400
      );
    };

    const service = new InstagramService(createConfig(), mockFetch);
    const result = await service.publish({
      text: 'Test',
      imageUrl: 'https://example.com/uploads/photo.jpg',
    });

    assert.equal(callCount, 2);
    assert.equal(result.platform, 'instagram');
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.ok(!result.error.includes(TEST_TOKEN));
    assert.ok(result.error.includes('[REDACTED]'));
    assert.ok(result.error.includes('(code 9007)'));
  });

  it('redacts token when fetch throws a network error', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error(
        `Connection reset with access_token=${TEST_TOKEN} and ${TEST_TOKEN}`
      );
    };

    const service = new InstagramService(createConfig(), mockFetch);
    const result = await service.publish({
      text: 'Test',
      imageUrl: 'https://example.com/uploads/photo.jpg',
    });

    assert.equal(result.platform, 'instagram');
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.ok(!result.error.includes(TEST_TOKEN));
    assert.ok(result.error.includes('[REDACTED]'));
  });
});
