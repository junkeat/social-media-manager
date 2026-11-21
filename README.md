# Social Media Publisher (Prototype)

A minimal TypeScript + Express web app for publishing a single post (text and optional image) to **Facebook**, **Instagram**, and **Threads** in parallel and viewing per-platform results.

## Prerequisites

- **Node.js 20+** (uses built-in `fetch`, `FormData`, `Blob`, and `node:test`; verified on Node v24.22.1)
- Meta API credentials and IDs for the platforms you plan to post to:
  - Facebook Page (`FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`)
  - Instagram Business Account (`IG_BUSINESS_ACCOUNT_ID`, using `FB_PAGE_ACCESS_TOKEN`)
  - Threads (`THREADS_USER_ID`, `THREADS_ACCESS_TOKEN`)
- A **public HTTPS URL** (such as an ngrok or Cloudflare Tunnel URL pointing to your local server) if publishing images to **Instagram** or **Threads**, because Meta fetches images from `${PUBLIC_BASE_URL}/uploads/<filename>`.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file from the template:

   ```bash
   cp .env.example .env
   ```

3. Fill in your environment variables in `.env` (see below).

## Environment Variables

| Variable | Required For | Description |
| :--- | :--- | :--- |
| `FB_PAGE_ID` | Facebook | Numeric ID of the target Facebook Page. |
| `FB_PAGE_ACCESS_TOKEN` | Facebook, Instagram | Page access token with permissions to publish to the Page and linked Instagram account. |
| `IG_BUSINESS_ACCOUNT_ID` | Instagram | Instagram Business Account ID linked to the Facebook Page. |
| `THREADS_USER_ID` | Threads | Threads user ID. |
| `THREADS_ACCESS_TOKEN` | Threads | Threads user access token (separate from the Facebook/Instagram token). |
| `PUBLIC_BASE_URL` | Instagram / Threads images | Publicly reachable base URL of this Express app (no trailing slash, e.g. `https://your-tunnel.example.com`). |
| `META_GRAPH_API_VERSION` | Facebook, Instagram | Meta Graph API version (optional; defaults to `v22.0` if empty). |
| `PORT` | Server | Local HTTP port for Express (optional; defaults to `3000`). |

## Build and Run

1. Build both the Express backend (`dist/`) and the browser TypeScript bundle (`public/app.js`):

   ```bash
   npm run build
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Open `http://localhost:3000` (or your configured `PORT`) in a browser.

## Scripts

- `npm run build` — compiles `src/` to `dist/` and `public/app.ts` to `public/app.js`
- `npm run typecheck` — runs `tsc --noEmit` across backend, test, and browser TypeScript configs
- `npm test` — builds browser & test targets and runs all automated tests (`node --test`)
- `npm start` — starts the compiled server (`node dist/index.js`)

## Platform Rules & Validation

- **At least one platform** must be selected, and either post text or an image must be provided.
- **Facebook Page** (`63,206` character limit; Meta's Graph API reference does not list a hard numeric limit for `message`, so Facebook's standard post limit is enforced):
  - Text-only posts call `POST /{FB_PAGE_ID}/feed`.
  - Image posts upload the image binary via multipart `FormData` to `POST /{FB_PAGE_ID}/photos`.
- **Instagram Business** (`2,200` character limit):
  - Requires a **JPEG** image (`.jpg` / `.jpeg`, max 8 MB). Requests without an image or with a non-JPEG file are rejected.
  - Uses the two-step container flow (`POST /{IG_BUSINESS_ACCOUNT_ID}/media` with public `image_url`, then `POST /{IG_BUSINESS_ACCOUNT_ID}/media_publish`).
- **Threads** (`500` character limit):
  - Uses `https://graph.threads.net/v1.0` with `THREADS_ACCESS_TOKEN`.
  - Uses the two-step container flow (`POST /{THREADS_USER_ID}/threads`, polling container status when an image is attached, then `POST /{THREADS_USER_ID}/threads_publish`).
- **Isolation & Security:** Platforms publish concurrently via `Promise.allSettled`, so one platform error (such as an invalid/expired token) does not stop the others. Access tokens are never logged or returned in API responses or web UI output.

## Project Structure

```text
.
├── .env.example
├── package.json
├── tsconfig.json
├── tsconfig.public.json
├── tsconfig.test.json
├── uploads/                     # Saved uploads served publicly at /uploads
├── public/                      # Plain HTML/CSS/TypeScript UI served by Express
│   ├── index.html
│   ├── styles.css
│   └── app.ts                   # Compiled to public/app.js
├── src/
│   ├── index.ts                 # Express server entry point
│   ├── config/
│   │   └── env.ts               # dotenv loading & typed config
│   ├── types/
│   │   └── post.ts              # Shared post & result interfaces
│   ├── validation/
│   │   └── postSchema.ts        # Zod & platform validation rules
│   ├── services/
│   │   ├── metaError.ts         # Error parsing & token redaction
│   │   ├── facebookService.ts
│   │   ├── instagramService.ts
│   │   └── threadsService.ts
│   ├── orchestrator/
│   │   └── publishOrchestrator.ts
│   └── routes/
│       └── publishRoute.ts      # POST /api/publish
└── tests/
    ├── facebookService.test.ts
    ├── instagramService.test.ts
    ├── threadsService.test.ts
    └── publishFlow.test.ts
```
