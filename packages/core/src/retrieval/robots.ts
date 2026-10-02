import robotsParser from "robots-parser";
import { fetchPage, USER_AGENT, type FetchOptions } from "./fetch-page.js";

export interface RobotsPolicy {
  isAllowed(url: string): boolean;
  sitemaps: string[];
  crawlDelayMs: number;
}

/**
 * Load robots.txt for an origin. A missing or unreachable robots.txt means
 * "no restrictions" (the standard interpretation); a fetched one is obeyed for
 * our user agent, including Crawl-delay (capped at 5s).
 */
export async function loadRobots(origin: string, opts: FetchOptions): Promise<RobotsPolicy> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  try {
    const page = await fetchPage(robotsUrl, { ...opts, retries: 0, accept: ["text/plain", "text/html", "application/octet-stream"], timeoutMs: 5000 });
    // Some sites serve HTML for unknown paths; that is not a robots file.
    const body = page.contentType.startsWith("text/html") ? "" : page.body;
    const robots = robotsParser(robotsUrl, body);
    const delay = robots.getCrawlDelay(USER_AGENT);
    return {
      isAllowed: (u) => robots.isAllowed(u, USER_AGENT) !== false,
      sitemaps: robots.getSitemaps(),
      crawlDelayMs: delay ? Math.min(delay * 1000, 5000) : 0,
    };
  } catch {
    return { isAllowed: () => true, sitemaps: [], crawlDelayMs: 0 };
  }
}
