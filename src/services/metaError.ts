export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redactTokens(text: string, tokens: readonly string[]): string {
  const uniqueTokens = Array.from(
    new Set(tokens.map((t) => t.trim()).filter((t) => t.length > 0))
  ).sort((a, b) => b.length - a.length);

  let sanitized = text;
  for (const token of uniqueTokens) {
    sanitized = sanitized.split(token).join('[REDACTED]');
  }

  return sanitized.replace(/access_token=[^&\s"']+/gi, 'access_token=[REDACTED]');
}

export async function safeParseJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function parseMetaError(
  status: number,
  body: unknown,
  platformLabel: string,
  tokens: readonly string[]
): string {
  const errorObj = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const message =
    typeof errorObj?.message === 'string' ? errorObj.message.trim() : '';
  const code = typeof errorObj?.code === 'number' ? errorObj.code : undefined;
  const subcode =
    typeof errorObj?.error_subcode === 'number' ? errorObj.error_subcode : undefined;

  // Meta OAuth code 190 (and HTTP 401) indicates an invalid or expired access token.
  if (status === 401 || code === 190) {
    if (subcode === 463) {
      return `${platformLabel} access token has expired. Generate a new token and update .env.`;
    }
    return `${platformLabel} access token is invalid or expired. Check your token in .env.`;
  }

  if (message.length > 0) {
    const safeMessage = redactTokens(message, tokens);
    return code !== undefined ? `${safeMessage} (code ${code})` : safeMessage;
  }

  return `${platformLabel} API request failed with HTTP ${status}.`;
}

export function formatUnexpectedError(
  err: unknown,
  platformLabel: string,
  tokens: readonly string[]
): string {
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : `${platformLabel} request failed unexpectedly.`;

  const normalized = rawMessage.trim() || `${platformLabel} request failed unexpectedly.`;
  return redactTokens(normalized, tokens);
}
