const errorText = error => String(error?.message || error || '');

export function isRetryableStorageError(error) {
  const message = errorText(error);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|failed with (?:408|409|425|429|5\d\d)\b/i.test(message);
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function withStorageRetry(operation, {
  attempts = 3,
  baseDelayMs = 150,
  shouldRetry = isRetryableStorageError,
  onRetry = () => {}
} = {}) {
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) throw error;
      onRetry({attempt, nextAttempt: attempt + 1, error});
      const delay = Math.max(0, Number(baseDelayMs) || 0) * (2 ** (attempt - 1));
      if (delay) await sleep(delay);
    }
  }

  throw lastError;
}
