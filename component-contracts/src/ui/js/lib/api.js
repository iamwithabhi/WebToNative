/**
 * The reader's only way to the server.
 *
 * Every request goes through here so a failure is one thing, an Error carrying
 * the server's own message, and no caller has to inspect a response.
 */

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}
