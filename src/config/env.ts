import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  fbPageId: string;
  fbPageAccessToken: string;
  igBusinessAccountId: string;
  threadsUserId: string;
  threadsAccessToken: string;
  publicBaseUrl: string;
  metaGraphApiVersion: string;
  port: number;
}

const DEFAULT_GRAPH_API_VERSION = 'v22.0';
const DEFAULT_PORT = 3000;

function readTrimmed(value: string | undefined): string {
  return value?.trim() ?? '';
}

function parsePort(value: string | undefined): number {
  const trimmed = readTrimmed(value);
  if (!trimmed) {
    return DEFAULT_PORT;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_PORT;
  }

  return parsed;
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const version = readTrimmed(env.META_GRAPH_API_VERSION) || DEFAULT_GRAPH_API_VERSION;

  return {
    fbPageId: readTrimmed(env.FB_PAGE_ID),
    fbPageAccessToken: readTrimmed(env.FB_PAGE_ACCESS_TOKEN),
    igBusinessAccountId: readTrimmed(env.IG_BUSINESS_ACCOUNT_ID),
    threadsUserId: readTrimmed(env.THREADS_USER_ID),
    threadsAccessToken: readTrimmed(env.THREADS_ACCESS_TOKEN),
    publicBaseUrl: stripTrailingSlashes(readTrimmed(env.PUBLIC_BASE_URL)),
    metaGraphApiVersion: version,
    port: parsePort(env.PORT),
  };
}
