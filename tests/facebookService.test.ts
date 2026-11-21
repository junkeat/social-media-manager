import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FacebookService, type FacebookConfig } from '../src/services/facebookService';

const TEST_TOKEN = 'EAAG-test-secret-page-token-12345';

function createConfig(overrides: Partial<FacebookConfig> = {}): FacebookConfig {
  return {
    fbPageId: '12345',
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

describe('FacebookService', () => {
  it('publishes a text-only post to /feed with token in POST body', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: URLSearchParams | FormData | undefined;

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? '';
      capturedBody = init?.body as URLSearchParams;
      return jsonResponse({ id: '12345_999' });
    };

    const service = new FacebookService(createConfig(), mockFetch);
    const result = await service.publish({ text: 'Hello Facebook Page' });

    assert.equal(capturedUrl, 'https://graph.facebook.com/v22.0/12345/feed');
    assert.equal(capturedMethod, 'POST');
    assert.ok(!capturedUrl.includes(TEST_TOKEN));
    assert.ok(capturedBody instanceof URLSearchParams);
    assert.equal(capturedBody.get('message'), 'Hello Facebook Page');
    assert.equal(capturedBody.get('access_token'), TEST_TOKEN);
    assert.deepEqual(result, {
      platform: 'facebook',
      success: true,
      postId: '12345_999',
    });
  });

  it('publishes a photo post via imagePath using multipart FormData and prefers post_id', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fb-test-'));
    const tempImage = path.join(tempDir, 'sample.jpg');
    await fs.promises.writeFile(tempImage, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    try {
      let capturedUrl = '';
      let capturedForm: FormData | undefined;

      const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedForm = init?.body as FormData;
        return jsonResponse({ id: 'photo_111', post_id: '12345_777' });
      };

      const service = new FacebookService(createConfig(), mockFetch);
      const result = await service.publish({
        text: 'Photo caption',
        imagePath: tempImage,
        imageMimeType: 'image/jpeg',
      });

      assert.equal(capturedUrl, 'https://graph.facebook.com/v22.0/12345/photos');
      assert.ok(capturedForm instanceof FormData);
      assert.equal(capturedForm.get('message'), 'Photo caption');
      assert.equal(capturedForm.get('access_token'), TEST_TOKEN);
      const sourceField = capturedForm.get('source');
      assert.ok(sourceField instanceof File);
      assert.equal(sourceField.name, 'sample.jpg');
      assert.equal(sourceField.type, 'image/jpeg');
      assert.deepEqual(result, {
        platform: 'facebook',
        success: true,
        postId: '12345_777',
      });
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('publishes a photo post via imageUrl and falls back to id when post_id is absent', async () => {
    let capturedUrl = '';
    let capturedBody: URLSearchParams | undefined;

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = init?.body as URLSearchParams;
      return jsonResponse({ id: 'photo_only_222' });
    };

    const service = new FacebookService(createConfig(), mockFetch);
    const result = await service.publish({
      text: 'Remote photo',
      imageUrl: 'https://example.com/uploads/test.jpg',
    });

    assert.equal(capturedUrl, 'https://graph.facebook.com/v22.0/12345/photos');
    assert.ok(capturedBody instanceof URLSearchParams);
    assert.equal(capturedBody.get('url'), 'https://example.com/uploads/test.jpg');
    assert.equal(capturedBody.get('message'), 'Remote photo');
    assert.equal(capturedBody.get('access_token'), TEST_TOKEN);
    assert.deepEqual(result, {
      platform: 'facebook',
      success: true,
      postId: 'photo_only_222',
    });
  });

  it('returns a clear message and redacts token on OAuth code 190 invalid token', async () => {
    const mockFetch: typeof fetch = async () =>
      jsonResponse(
        {
          error: {
            message: `Invalid OAuth access token ${TEST_TOKEN}`,
            type: 'OAuthException',
            code: 190,
          },
        },
        400
      );

    const service = new FacebookService(createConfig(), mockFetch);
    const result = await service.publish({ text: 'Test post' });

    assert.equal(result.platform, 'facebook');
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.ok(!result.error.includes(TEST_TOKEN));
    assert.match(result.error, /invalid or expired/i);
  });

  it('returns a clear expired message on OAuth code 190 subcode 463', async () => {
    const mockFetch: typeof fetch = async () =>
      jsonResponse(
        {
          error: {
            message: 'Session has expired on Monday',
            type: 'OAuthException',
            code: 190,
            error_subcode: 463,
          },
        },
        400
      );

    const service = new FacebookService(createConfig(), mockFetch);
    const result = await service.publish({ text: 'Test post' });

    assert.equal(result.platform, 'facebook');
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.ok(!result.error.includes(TEST_TOKEN));
    assert.match(result.error, /has expired/i);
  });

  it('redacts token from non-auth Graph API error messages', async () => {
    const mockFetch: typeof fetch = async () =>
      jsonResponse(
        {
          error: {
            message: `Request failed with access_token=${TEST_TOKEN} and token ${TEST_TOKEN}`,
            code: 100,
          },
        },
        400
      );

    const service = new FacebookService(createConfig(), mockFetch);
    const result = await service.publish({ text: 'Test post' });

    assert.equal(result.platform, 'facebook');
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.ok(!result.error.includes(TEST_TOKEN));
    assert.ok(result.error.includes('[REDACTED]'));
    assert.ok(result.error.includes('(code 100)'));
  });

  it('redacts token when fetch rejects with a network error containing the token', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error(`Network failure for access_token=${TEST_TOKEN} (${TEST_TOKEN})`);
    };

    const service = new FacebookService(createConfig(), mockFetch);
    const result = await service.publish({ text: 'Test post' });

    assert.equal(result.platform, 'facebook');
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.ok(!result.error.includes(TEST_TOKEN));
    assert.ok(result.error.includes('[REDACTED]'));
  });

  it('returns a failure result without calling fetch when credentials are missing', async () => {
    let fetchCalled = false;
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true;
      return jsonResponse({ id: 'should-not-happen' });
    };

    const service = new FacebookService(
      createConfig({ fbPageId: '', fbPageAccessToken: '' }),
      mockFetch
    );
    const result = await service.publish({ text: 'Test post' });

    assert.equal(fetchCalled, false);
    assert.equal(result.platform, 'facebook');
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /credentials/i);
  });
});
