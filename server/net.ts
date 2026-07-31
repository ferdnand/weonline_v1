/**
 * Network address helpers shared by the server (kept dependency-free and pure so
 * they are easy to unit-test).
 */

/**
 * True only for RFC1918 private IPv4 addresses (10/8, 172.16/12, 192.168/16).
 * Deliberately rejects public IPs, loopback (127/8), and link-local/metadata
 * (169.254/16) to contain SSRF via the live-router driver.
 */
export function isPrivateIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
