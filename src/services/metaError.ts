export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redactTokens(text: string, tokens: readonly string[]): string {
  let safe = text;
  for (const token of tokens.filter(Boolean)) {
    safe = safe.split(token).join('[REDACTED]');
  }
  return safe.replace(/access_token=[^&\s"']+/gi, 'access_token=[REDACTED]');
}

export async function safeParseJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    return undefined;
  }
}

/** Turns a failed Meta API reply into a short, token-free message. */
export function parseMetaError(
  status: number,
  body: unknown,
  label: string,
  tokens: readonly string[]
): string {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const { message, code, error_subcode: subcode } = error;

  // Code 190 (or HTTP 401) means the access token is invalid or expired.
  if (status === 401 || code === 190) {
    return subcode === 463
      ? `${label} access token has expired. Generate a new token and update .env.`
      : `${label} access token is invalid or expired. Check your token in .env.`;
  }

  if (typeof message === 'string' && message.trim()) {
    const safe = redactTokens(message.trim(), tokens);
    return typeof code === 'number' ? `${safe} (code ${code})` : safe;
  }

  return `${label} API request failed with HTTP ${status}.`;
}

export function formatUnexpectedError(
  err: unknown,
  label: string,
  tokens: readonly string[]
): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return redactTokens(message.trim() || `${label} request failed unexpectedly.`, tokens);
}
