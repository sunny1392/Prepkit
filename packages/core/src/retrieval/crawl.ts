import { isIP } from "node:net";
import { cleanHtml, guessCompanyName } from "./clean.js";
import { fetchPage, type FetchOptions } from "./fetch-page.js";
import { hiringContentScore, rankLinks, scoreLink, type PageKind, type ScoredLink } from "./rank-links.js";
import { loadRobots } from "./robots.js";
import { assertFetchable, normaliseUrl } from "./url-guard.js";
import { PrepError } from "../util/errors.js";

export interface CrawledPage {
  url: string;
  title: string;
  description: string;
  text: string;
  kind: PageKind | "home";
  linkScore: number;
  hiringContent: number;
}

export interface CrawlResult {
  reachable: boolean;
  startUrl: string;
  companyName: string;
  pages: CrawledPage[];
  skipped: Array<{ url: string; reason: string }>;
  /** Best page that looks like careers/jobs/hiring. */
  hiringPageUrl: string | null;
  /** True only when some page's content actually describes how they interview. */
  processDescribed: boolean;
  error?: { code: string; message: string };
}

export interface CrawlOptions {
  allowPrivate: boolean;
  maxPages?: number;
  maxDepth?: number;
  onProgress?: (msg: string) => void;
}

const MAX_HIRING_PAGES = 6;
const MAX_ABOUT_PAGES = 4;

function siteScope(start: URL) {
  const host = start.hostname;
  const ip = isIP(host.replace(/^\[|\]$/g, "")) !== 0 || host === "localhost";
  const base = ip ? host : host.split(".").slice(-2).join(".");
  // If the company lives under a path (e.g. http://localhost:8099/acme/), stay under it on that host.
  const prefix = start.pathname.endsWith("/") ? start.pathname : start.pathname.replace(/[^/]*$/, "");
  return (u: URL) => {
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.host === start.host) return u.pathname.startsWith(prefix);
    if (ip) return false;
    return u.hostname === base || u.hostname.endsWith(`.${base}`);
  };
}

async function sitemapUrls(origin: string, declared: string[], fetchOpts: FetchOptions, inScope: (u: URL) => boolean): Promise<string[]> {
  const candidates = declared.length ? declared.slice(0, 2) : [new URL("/sitemap.xml", origin).toString()];
  const out: string[] = [];
  for (const sm of candidates) {
    try {
      const page = await fetchPage(sm, { ...fetchOpts, retries: 0, accept: ["application/xml", "text/xml", "text/plain"], timeoutMs: 5000 });
      for (const m of page.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        try {
          const u = new URL(m[1].replace(/&amp;/g, "&"));
          if (inScope(u)) out.push(u.toString());
        } catch {
          /* ignore malformed */
        }
        if (out.length >= 300) break;
      }
    } catch {
      /* sitemap is optional */
    }
  }
  return out;
}

/**
 * Best-first crawl of a company site. Starts at the given URL, collects every
 * in-scope link the site exposes (anchors + sitemap), scores them for
 * hiring/about signals, and fetches the most promising ones until a page
 * budget is spent. Failures on individual pages are recorded and skipped.
 */
export async function crawlCompany(rawUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? 12;
  const maxDepth = options.maxDepth ?? 3;
  const log = options.onProgress ?? (() => {});
  const skipped: CrawlResult["skipped"] = [];
  const empty = (startUrl: string, error: { code: string; message: string }, companyName = ""): CrawlResult => ({
    reachable: false,
    startUrl,
    companyName,
    pages: [],
    skipped,
    hiringPageUrl: null,
    processDescribed: false,
    error,
  });

  let start: URL;
  try {
    start = await assertFetchable(normaliseUrl(rawUrl), options);
  } catch (err) {
    const e = err instanceof PrepError ? err : new PrepError("INVALID_URL", String(err));
    return empty(rawUrl, { code: e.code, message: e.message });
  }

  const fetchOpts: FetchOptions = { allowPrivate: options.allowPrivate };
  const robots = await loadRobots(start.origin, fetchOpts);
  if (robots.crawlDelayMs) fetchOpts.perHostIntervalMs = robots.crawlDelayMs;

  if (!robots.isAllowed(start.toString())) {
    skipped.push({ url: start.toString(), reason: "disallowed by robots.txt" });
    return empty(start.toString(), { code: "ROBOTS_DISALLOWED", message: "robots.txt disallows crawling this site." });
  }

  log(`Fetching ${start}`);
  let home;
  try {
    home = await fetchPage(start, fetchOpts);
  } catch (err) {
    const e = err instanceof PrepError ? err : new PrepError("NETWORK", String(err));
    skipped.push({ url: start.toString(), reason: e.message });
    return empty(start.toString(), { code: "COMPANY_UNREACHABLE", message: `Company site unreachable: ${e.message}` });
  }

  const homeUrl = new URL(home.url);
  const inScope = siteScope(homeUrl);
  const homeClean = cleanHtml(home.body, home.url);
  const pages: CrawledPage[] = [
    {
      url: home.url,
      title: homeClean.title,
      description: homeClean.description,
      text: homeClean.text,
      kind: "home",
      linkScore: 0,
      hiringContent: hiringContentScore(homeClean.text),
    },
  ];
  const companyName = guessCompanyName(homeClean, home.url);

  const visited = new Set<string>([start.toString(), home.url]);
  const frontier = new Map<string, ScoredLink & { depth: number }>();
  const addLinks = (links: Array<{ url: string; text: string }>, depth: number, boost = 0) => {
    for (const l of links) {
      let u: URL;
      try {
        u = new URL(l.url);
      } catch {
        continue;
      }
      if (!inScope(u) || visited.has(u.toString()) || depth > maxDepth) continue;
      const s = scoreLink(u.toString(), l.text);
      s.score += s.kind === "hiring" ? boost : 0;
      const prev = frontier.get(s.url);
      if (!prev || prev.score < s.score) frontier.set(s.url, { ...s, depth });
    }
  };
  addLinks(homeClean.links, 1);
  addLinks((await sitemapUrls(homeUrl.origin, robots.sitemaps, fetchOpts, inScope)).map((url) => ({ url, text: "" })), 1);
  log(`Found ${frontier.size} candidate links`);

  const kindCount = { hiring: 0, about: 0, other: 0 };
  while (pages.length < maxPages) {
    const next = rankLinks([...frontier.values()]).find((l) => {
      if (l.score <= 0) return false;
      if (l.kind === "hiring") return kindCount.hiring < MAX_HIRING_PAGES;
      if (l.kind === "about") return kindCount.about < MAX_ABOUT_PAGES;
      return false;
    });
    if (!next) break;
    const depth = frontier.get(next.url)!.depth;
    frontier.delete(next.url);
    visited.add(next.url);
    if (!robots.isAllowed(next.url)) {
      skipped.push({ url: next.url, reason: "disallowed by robots.txt" });
      continue;
    }
    log(`Fetching ${next.kind} page ${next.url}`);
    try {
      const page = await fetchPage(next.url, fetchOpts);
      visited.add(page.url);
      const clean = cleanHtml(page.body, page.url);
      const hc = hiringContentScore(clean.text);
      // A page whose content is about hiring counts as hiring even if its URL didn't say so.
      const kind: PageKind = hc >= 3 ? "hiring" : next.kind;
      kindCount[kind]++;
      pages.push({ url: page.url, title: clean.title, description: clean.description, text: clean.text, kind, linkScore: next.score, hiringContent: hc });
      // Links from a hiring page (e.g. careers → "our interview process") get a context boost.
      addLinks(clean.links, depth + 1, kind === "hiring" ? 2 : 0);
    } catch (err) {
      const e = err instanceof PrepError ? err : new PrepError("NETWORK", String(err));
      skipped.push({ url: next.url, reason: e.message });
    }
  }

  const hiringPages = pages.filter((p) => p.kind === "hiring").sort((a, b) => b.hiringContent * 2 + b.linkScore - (a.hiringContent * 2 + a.linkScore));
  return {
    reachable: true,
    startUrl: start.toString(),
    companyName,
    pages,
    skipped,
    hiringPageUrl: hiringPages[0]?.url ?? null,
    processDescribed: pages.some((p) => p.hiringContent >= 2 && p.kind !== "about"),
  };
}
