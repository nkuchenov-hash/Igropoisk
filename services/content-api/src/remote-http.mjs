export async function readLimitedBody(response, maximumBytes, label) {
  if (response.status >= 300 && response.status < 400) throw new Error(`${label} redirects are forbidden.`);
  if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}.`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > maximumBytes) throw new Error(`${label} exceeds the maximum allowed size.`);
  if (!response.body) throw new Error(`${label} response has no body.`);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeds the maximum allowed size.`);
    }
    chunks.push(Buffer.from(value));
  }
  const body = Buffer.concat(chunks, total);
  if (declared && body.length !== declared) throw new Error(`${label} size differs from Content-Length.`);
  return body;
}

export async function fetchLimitedBody(fetchImpl, url, { timeoutMs, maximumBytes, label }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'manual', headers: { Accept: 'application/json' }, signal: controller.signal
    });
    return await readLimitedBody(response, maximumBytes, label);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${label} request timed out.`);
    throw error;
  } finally { clearTimeout(timer); }
}
