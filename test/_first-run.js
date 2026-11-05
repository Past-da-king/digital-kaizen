// Shared bits for the first-run tests (each test file is its own process with its own temp data).
export const STRONG = 'Correct-Horse-Battery-9';
export const jar = (base) => {
  const cookies = {};
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie?.() || []) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      if (/Max-Age=0/.test(c)) delete cookies[kv.slice(0, i)]; else cookies[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, body: json, text, location: r.headers.get('location') };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}, h) => call('POST', p, b, h) };
};
