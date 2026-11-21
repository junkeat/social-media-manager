import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AppConfig } from '../src/config/env';
import { createApp } from '../src/index';
import { FacebookService } from '../src/services/facebookService';
import { InstagramService } from '../src/services/instagramService';
import { ThreadsService } from '../src/services/threadsService';
import type {
  Platform,
  PlatformResult,
  PlatformService,
  PublishInput,
} from '../src/types/post';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function listenServer(
  handler: http.RequestListener
): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

describe('Publish flow & acceptance tests', () => {
  let tempUploadsDir = '';

  before(async () => {
    tempUploadsDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'smm-uploads-')
    );
  });

  after(async () => {
    if (tempUploadsDir) {
      await fs.promises.rm(tempUploadsDir, { recursive: true, force: true });
    }
  });

  it('publishes text and JPEG image to all three platforms in parallel and serves the image publicly', async () => {
    const recordedInputs: Partial<Record<Platform, PublishInput>> = {};
    const createStub = (platform: Platform, postId: string): PlatformService => ({
      platform,
      async publish(input: PublishInput): Promise<PlatformResult> {
        recordedInputs[platform] = input;
        return { platform, success: true, postId };
      },
    });

    const app = createApp({
      uploadsDir: tempUploadsDir,
      config: {
        fbPageId: 'fb-1',
        fbPageAccessToken: 'fb-tok',
        igBusinessAccountId: 'ig-1',
        threadsUserId: 'th-1',
        threadsAccessToken: 'th-tok',
        publicBaseUrl: 'https://public.example.com',
        metaGraphApiVersion: 'v22.0',
        port: 0,
      },
      services: {
        facebook: createStub('facebook', 'fb-post-101'),
        instagram: createStub('instagram', 'ig-post-202'),
        threads: createStub('threads', 'th-post-303'),
      },
    });

    const { server, baseUrl } = await listenServer(app);
    try {
      const form = new FormData();
      form.append('text', 'Launch day across all three!');
      form.append('platforms', 'facebook');
      form.append('platforms', 'instagram');
      form.append('platforms', 'threads');
      form.append(
        'image',
        new Blob([new Uint8Array(JPEG_BYTES)], { type: 'image/jpeg' }),
        'launch.jpg'
      );

      const response = await fetch(`${baseUrl}/api/publish`, {
        method: 'POST',
        body: form,
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as { results: PlatformResult[] };
      assert.deepEqual(body.results, [
        { platform: 'facebook', success: true, postId: 'fb-post-101' },
        { platform: 'instagram', success: true, postId: 'ig-post-202' },
        { platform: 'threads', success: true, postId: 'th-post-303' },
      ]);

      const expectedUrlPrefix = 'https://public.example.com/uploads/';
      assert.ok(recordedInputs.facebook?.imagePath);
      assert.ok(recordedInputs.instagram?.imageUrl?.startsWith(expectedUrlPrefix));
      assert.equal(
        recordedInputs.instagram?.imageUrl,
        recordedInputs.threads?.imageUrl
      );

      const uploadedFilename = path.basename(recordedInputs.facebook.imagePath);
      const uploadResponse = await fetch(`${baseUrl}/uploads/${uploadedFilename}`);
      assert.equal(uploadResponse.status, 200);
      const servedBytes = Buffer.from(await uploadResponse.arrayBuffer());
      assert.deepEqual(servedBytes, JPEG_BYTES);
    } finally {
      await closeServer(server);
    }
  });

  it('posts text-only to a single selected platform (Facebook)', async () => {
    const called: Platform[] = [];
    const makeStub = (platform: Platform): PlatformService => ({
      platform,
      async publish(): Promise<PlatformResult> {
        called.push(platform);
        return { platform, success: true, postId: `${platform}-only-1` };
      },
    });

    const app = createApp({
      uploadsDir: tempUploadsDir,
      services: {
        facebook: makeStub('facebook'),
        instagram: makeStub('instagram'),
        threads: makeStub('threads'),
      },
    });

    const { server, baseUrl } = await listenServer(app);
    try {
      const form = new FormData();
      form.append('text', 'Facebook-only update');
      form.append('platforms', 'facebook');

      const response = await fetch(`${baseUrl}/api/publish`, {
        method: 'POST',
        body: form,
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as { results: PlatformResult[] };
      assert.deepEqual(called, ['facebook']);
      assert.deepEqual(body.results, [
        { platform: 'facebook', success: true, postId: 'facebook-only-1' },
      ]);
    } finally {
      await closeServer(server);
    }
  });

  it('blocks Instagram when no image is attached without invoking any service', async () => {
    let called = false;
    const unusedStub = (platform: Platform): PlatformService => ({
      platform,
      async publish(): Promise<PlatformResult> {
        called = true;
        return { platform, success: true };
      },
    });

    const app = createApp({
      uploadsDir: tempUploadsDir,
      services: {
        facebook: unusedStub('facebook'),
        instagram: unusedStub('instagram'),
        threads: unusedStub('threads'),
      },
    });

    const { server, baseUrl } = await listenServer(app);
    try {
      const form = new FormData();
      form.append('text', 'Trying IG without an image');
      form.append('platforms', 'facebook');
      form.append('platforms', 'instagram');

      const response = await fetch(`${baseUrl}/api/publish`, {
        method: 'POST',
        body: form,
      });

      assert.equal(response.status, 400);
      assert.equal(called, false);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /instagram requires an image/i);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects non-JPEG files for Instagram and cleans up the rejected upload', async () => {
    let called = false;
    const unusedStub = (platform: Platform): PlatformService => ({
      platform,
      async publish(): Promise<PlatformResult> {
        called = true;
        return { platform, success: true };
      },
    });

    const isolatedDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'smm-png-reject-')
    );
    const app = createApp({
      uploadsDir: isolatedDir,
      services: {
        facebook: unusedStub('facebook'),
        instagram: unusedStub('instagram'),
        threads: unusedStub('threads'),
      },
    });

    const { server, baseUrl } = await listenServer(app);
    try {
      const form = new FormData();
      form.append('text', 'PNG test');
      form.append('platforms', 'instagram');
      form.append(
        'image',
        new Blob([new Uint8Array(PNG_BYTES)], { type: 'image/png' }),
        'graphic.png'
      );

      const response = await fetch(`${baseUrl}/api/publish`, {
        method: 'POST',
        body: form,
      });

      assert.equal(response.status, 400);
      assert.equal(called, false);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /jpeg/i);

      const remainingFiles = await fs.promises.readdir(isolatedDir);
      assert.deepEqual(remainingFiles, []);
    } finally {
      await closeServer(server);
      await fs.promises.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('rejects requests with no platform selected or text exceeding platform limits', async () => {
    const unusedStub = (platform: Platform): PlatformService => ({
      platform,
      async publish(): Promise<PlatformResult> {
        return { platform, success: true };
      },
    });

    const app = createApp({
      uploadsDir: tempUploadsDir,
      services: {
        facebook: unusedStub('facebook'),
        instagram: unusedStub('instagram'),
        threads: unusedStub('threads'),
      },
    });

    const { server, baseUrl } = await listenServer(app);
    try {
      const noPlatformForm = new FormData();
      noPlatformForm.append('text', 'Orphan post');

      const noPlatformRes = await fetch(`${baseUrl}/api/publish`, {
        method: 'POST',
        body: noPlatformForm,
      });
      assert.equal(noPlatformRes.status, 400);
      const noPlatformBody = (await noPlatformRes.json()) as { error: string };
      assert.match(noPlatformBody.error, /select at least one platform/i);

      const overLimitForm = new FormData();
      overLimitForm.append('text', 'a'.repeat(501));
      overLimitForm.append('platforms', 'threads');

      const overLimitRes = await fetch(`${baseUrl}/api/publish`, {
        method: 'POST',
        body: overLimitForm,
      });
      assert.equal(overLimitRes.status, 400);
      const overLimitBody = (await overLimitRes.json()) as { error: string };
      assert.match(overLimitBody.error, /threads.*500/i);
    } finally {
      await closeServer(server);
    }
  });

  it('continues publishing other platforms and redacts tokens when one platform fails with an invalid token', async () => {
    const fbSecretToken = 'EAAG-secret-fb-token-xyz';
    const thSecretToken = 'THAA-secret-threads-token-uvw';

    const config: AppConfig = {
      fbPageId: 'fb-page-1',
      fbPageAccessToken: fbSecretToken,
      igBusinessAccountId: 'ig-biz-1',
      threadsUserId: 'th-user-1',
      threadsAccessToken: thSecretToken,
      publicBaseUrl: 'https://public.example.com',
      metaGraphApiVersion: 'v22.0',
      port: 0,
    };

    const fbFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ id: 'photo-1', post_id: 'fb-ok-111' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const igFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: `Invalid OAuth access token ${fbSecretToken}`,
            code: 190,
          },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    let thStep = 0;
    const thFetch: typeof fetch = async () => {
      thStep += 1;
      if (thStep === 1) {
        return new Response(JSON.stringify({ id: 'th-container-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (thStep === 2) {
        return new Response(
          JSON.stringify({ id: 'th-container-1', status: 'FINISHED' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(JSON.stringify({ id: 'th-ok-333' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const app = createApp({
      uploadsDir: tempUploadsDir,
      config,
      services: {
        facebook: new FacebookService(config, fbFetch),
        instagram: new InstagramService(config, igFetch),
        threads: new ThreadsService(config, thFetch, {
          maxAttempts: 2,
          pollIntervalMs: 0,
          sleepFn: async () => {},
        }),
      },
    });

    const { server, baseUrl } = await listenServer(app);
    try {
      const form = new FormData();
      form.append('text', 'Resilient publish test');
      form.append('platforms', 'facebook');
      form.append('platforms', 'instagram');
      form.append('platforms', 'threads');
      form.append(
        'image',
        new Blob([new Uint8Array(JPEG_BYTES)], { type: 'image/jpeg' }),
        'photo.jpeg'
      );

      const response = await fetch(`${baseUrl}/api/publish`, {
        method: 'POST',
        body: form,
      });

      assert.equal(response.status, 200);
      const rawText = await response.text();
      assert.ok(!rawText.includes(fbSecretToken));
      assert.ok(!rawText.includes(thSecretToken));

      const body = JSON.parse(rawText) as { results: PlatformResult[] };
      assert.equal(body.results.length, 3);
      assert.deepEqual(body.results[0], {
        platform: 'facebook',
        success: true,
        postId: 'fb-ok-111',
      });
      assert.equal(body.results[1].platform, 'instagram');
      assert.equal(body.results[1].success, false);
      assert.match(body.results[1].error ?? '', /invalid or expired/i);
      assert.deepEqual(body.results[2], {
        platform: 'threads',
        success: true,
        postId: 'th-ok-333',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('serves the static HTML page and compiled client TypeScript bundle', async () => {
    const unusedStub = (platform: Platform): PlatformService => ({
      platform,
      async publish(): Promise<PlatformResult> {
        return { platform, success: true };
      },
    });

    const app = createApp({
      uploadsDir: tempUploadsDir,
      services: {
        facebook: unusedStub('facebook'),
        instagram: unusedStub('instagram'),
        threads: unusedStub('threads'),
      },
    });

    const { server, baseUrl } = await listenServer(app);
    try {
      const htmlRes = await fetch(`${baseUrl}/`);
      assert.equal(htmlRes.status, 200);
      const html = await htmlRes.text();
      assert.match(html, /Social Media Publisher/);
      assert.match(html, /src="\/app\.js"/);

      const jsRes = await fetch(`${baseUrl}/app.js`);
      assert.equal(jsRes.status, 200);
      const js = await jsRes.text();
      assert.match(js, /\/api\/publish/);
    } finally {
      await closeServer(server);
    }
  });
});
