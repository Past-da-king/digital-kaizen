// ============================================================
// Which address goes into links (invite, acknowledge, QR codes).
//
// Order of precedence, everywhere links are made:
//   1. Settings > Dashboard address          (saved on the screen)
//   2. DK_BASE_URL in .env                   (starting value)
//   3. this PC's best network address        (guessed, see below)
//
// The guess prefers a real LAN address. A PC on Tailscale or a VPN, or
// one with Docker, WSL or VirtualBox adapters, has several: those
// virtual ones used to win by accident and put a 100.x address in
// every invite link. Now: ordinary private LAN ranges first, then other
// real addresses, then 100.64/10 (Tailscale and carrier NAT), then
// link-local. Adapters whose NAME says virtual are tried last.
// ============================================================
import { networkInterfaces } from 'node:os';

const VIRTUAL_NAME = /tailscale|zerotier|^zt|docker|^br-|^veth|virbr|vmnet|vmware|virtualbox|vboxnet|vethernet|hyper-v|wsl|^utun|^tun\d|^tap|^wg\d|wireguard|npcap|bluetooth|loopback/i;

// 0 private LAN, 3 other real address, 4 100.64/10, 5 link-local
export function rangeRank(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return 9;
  if (p[0] === 192 && p[1] === 168) return 0;
  if (p[0] === 10) return 0;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return 0;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return 4;
  if (p[0] === 169 && p[1] === 254) return 5;
  if (p[0] === 0 || p[0] >= 224) return 9;
  return 3;
}

// ifaces has the shape of os.networkInterfaces(). Returns { address, iface, why } or null.
export function pickAddress(ifaces = networkInterfaces()) {
  const cands = [];
  let order = 0;
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const virtual = VIRTUAL_NAME.test(name);
      const rank = rangeRank(a.address);
      if (rank === 9) continue;
      cands.push({ address: a.address, iface: name, virtual, rank, score: rank === 5 ? 30 : (virtual ? 10 : 0) + rank, /* 169.254 = no real network: always last */ order: order++ });
    }
  }
  if (!cands.length) return null;
  cands.sort((x, y) => x.score - y.score || x.order - y.order);
  const c = cands[0];
  const why = c.virtual ? 'only virtual adapters found' : c.rank === 0 ? 'private LAN address' : c.rank === 3 ? 'network address' : c.rank === 4 ? 'only a 100.x (Tailscale or VPN) address found' : 'only a link-local address found';
  return { address: c.address, iface: c.iface, why };
}

export function lanAddress(ifaces) { return pickAddress(ifaces)?.address || 'localhost'; }

// DK_BASE_URL, cleaned: no trailing slash, must be http(s). null when unset or not usable.
export function envBaseUrl(env = process.env) {
  const raw = String(env.DK_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  return /^https?:\/\/[^\s/]+$/i.test(raw) ? raw : null;
}
export const envBaseUrlProblem = (env = process.env) =>
  String(env.DK_BASE_URL || '').trim() && !envBaseUrl(env) ? `DK_BASE_URL "${env.DK_BASE_URL}" is ignored: it must look like http://192.168.1.20:4310 (no path).` : null;

// The URL, and where it came from.
export function resolveBaseUrl({ saved = '', port, env = process.env, ifaces } = {}) {
  const s = String(saved || '').trim().replace(/\/+$/, '');
  if (s) return { url: s, source: 'Settings > Dashboard address' };
  const e = envBaseUrl(env);
  if (e) return { url: e, source: 'DK_BASE_URL in .env' };
  const p = pickAddress(ifaces);
  return { url: `http://${p ? p.address : 'localhost'}:${port}`, source: p ? `this PC's ${p.why} (${p.iface})` : 'no network address found, using localhost' };
}
