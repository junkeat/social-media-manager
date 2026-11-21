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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const read = (name: string): string => env[name]?.trim() ?? '';
  const port = Number(read('PORT'));

  return {
    fbPageId: read('FB_PAGE_ID'),
    fbPageAccessToken: read('FB_PAGE_ACCESS_TOKEN'),
    igBusinessAccountId: read('IG_BUSINESS_ACCOUNT_ID'),
    threadsUserId: read('THREADS_USER_ID'),
    threadsAccessToken: read('THREADS_ACCESS_TOKEN'),
    publicBaseUrl: read('PUBLIC_BASE_URL').replace(/\/+$/, ''),
    metaGraphApiVersion: read('META_GRAPH_API_VERSION') || 'v22.0',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000,
  };
}
