import { PLATFORM_LABELS, type Platform, type PlatformResult } from '../types/post';
import { formatUnexpectedError, isRecord, parseMetaError, safeParseJson } from './metaError';

/** Builds a form body from `fields`, skipping empty values, and adds the token. */
export function formBody(
  fields: Record<string, string | undefined>,
  token: string
): URLSearchParams {
  const body = new URLSearchParams({ access_token: token });
  for (const [key, value] of Object.entries(fields)) {
    if (value) body.set(key, value);
  }
  return body;
}

/** Sends a request and returns the parsed JSON. Throws a token-free message on failure. */
export async function sendJson(
  fetchFn: typeof fetch,
  platform: Platform,
  token: string,
  url: string,
  init: RequestInit
): Promise<unknown> {
  const response = await fetchFn(url, init);
  const payload = await safeParseJson(response);

  if (!response.ok) {
    throw new Error(parseMetaError(response.status, payload, PLATFORM_LABELS[platform], [token]));
  }
  return payload;
}

/** POSTs `body` and returns the first of `idFields` found in the reply. */
export async function postForId(
  fetchFn: typeof fetch,
  platform: Platform,
  token: string,
  url: string,
  body: URLSearchParams | FormData,
  idFields: string[] = ['id']
): Promise<string> {
  const payload = await sendJson(fetchFn, platform, token, url, { method: 'POST', body });

  for (const field of idFields) {
    const value = isRecord(payload) ? payload[field] : undefined;
    if (typeof value === 'string' && value) return value;
  }
  throw new Error(`${PLATFORM_LABELS[platform]} API succeeded but did not return an ID.`);
}

/**
 * Shared publish flow: stop with `problem` if there is one, otherwise run `action`.
 * Any error becomes a failed result, so one platform never throws into another.
 */
export async function runPublish(
  platform: Platform,
  token: string,
  problem: string | undefined,
  action: () => Promise<string>
): Promise<PlatformResult> {
  if (problem) return { platform, success: false, error: problem };

  try {
    return { platform, success: true, postId: await action() };
  } catch (err: unknown) {
    const error = formatUnexpectedError(err, PLATFORM_LABELS[platform], [token]);
    return { platform, success: false, error };
  }
}
