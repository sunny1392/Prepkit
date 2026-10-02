import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PrepError } from "../util/errors.js";

export interface UrlGuardOptions {
  /** Permit loopback/private targets. Off in production; on for local evaluation. */
  allowPrivate: boolean;
}

/** Parse and normalise a user-supplied company URL (adds https:// if no scheme). */
export function normaliseUrl(raw: string): URL {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) throw new PrepError("INVALID_URL", "Company URL is empty.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new PrepError("INVALID_URL", `"${raw}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PrepError("INVALID_URL", `Only http and https URLs are supported (got ${url.protocol}).`);
  }
  if (url.username || url.password) throw new PrepError("INVALID_URL", "URLs with credentials are not allowed.");
  if (!url.hostname) throw new PrepError("INVALID_URL", "URL has no host.");
  url.hash = "";
  return url;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (fam === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
    if (/^ff/.test(lower)) return true; // multicast
    return false;
  }
  return true; // not an IP at all — treat as unsafe
}

/**
 * Validate a URL before any fetch: scheme, credentials, and (unless allowed)
 * that every address the host resolves to is public. Called again on every
 * redirect hop so a public URL cannot bounce us to 127.0.0.1.
 *
 * Known limitation: DNS could in theory re-resolve differently between this
 * check and the connect (rebinding). Pinning the resolved IP would close that.
 */
export async function assertFetchable(raw: string | URL, opts: UrlGuardOptions): Promise<URL> {
  const url = typeof raw === "string" ? normaliseUrl(raw) : raw;
  if (opts.allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new PrepError("BLOCKED_URL", `Refusing to fetch private host "${host}".`);
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new PrepError("DNS_FAILED", `Could not resolve host "${host}".`);
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new PrepError("BLOCKED_URL", `Refusing to fetch "${host}": it resolves to a private or loopback address.`);
  }
  return url;
}
