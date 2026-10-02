import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import type { Server } from "node:http";
import { startStaticServer } from "./helpers/static-server.js";
import { crawlCompany } from "../src/retrieval/crawl.js";
import { cleanHtml } from "../src/retrieval/clean.js";
import { scoreLink } from "../src/retrieval/rank-links.js";
import { assertFetchable, isPrivateAddress, normaliseUrl } from "../src/retrieval/url-guard.js";

let server: Server;
let base: string;
beforeAll(async () => {
  ({ server, url: base } = await startStaticServer(join(__dirname, "..", "..", "..", "fixtures", "sites")));
});
afterAll(() => server.close());

describe("url guard", () => {
  it("rejects loopback/private targets in production mode", async () => {
    await expect(assertFetchable("http://127.0.0.1/", { allowPrivate: false })).rejects.toMatchObject({ code: "BLOCKED_URL" });
    await expect(assertFetchable("http://localhost:8099/", { allowPrivate: false })).rejects.toMatchObject({ code: "BLOCKED_URL" });
    await expect(assertFetchable("http://[::1]/", { allowPrivate: false })).rejects.toMatchObject({ code: "BLOCKED_URL" });
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.20.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.0.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
  it("normalises and rejects bad schemes", () => {
    expect(normaliseUrl("example.com").toString()).toBe("https://example.com/");
    expect(() => normaliseUrl("ftp://x.com")).toThrow();
    expect(() => normaliseUrl("javascript:alert(1)")).toThrow();
    expect(() => normaliseUrl("")).toThrow();
  });
});

describe("link ranking", () => {
  it("scores hiring links above generic ones without a fixed path list", () => {
    const hire = scoreLink("https://x.com/handbook/hiring/interviewing", "Interviewing");
    const team = scoreLink("https://x.com/company/life", "Life at X");
    const blog = scoreLink("https://x.com/blog/2021/03/some-post", "Some post");
    const privacy = scoreLink("https://x.com/legal/privacy", "Privacy");
    expect(hire.kind).toBe("hiring");
    expect(hire.score).toBeGreaterThan(team.score);
    expect(blog.score).toBeLessThanOrEqual(0);
    expect(privacy.score).toBeLessThan(0);
  });
});

describe("cleanHtml", () => {
  it("resolves relative links against the page URL and strips scripts", () => {
    const page = cleanHtml(`<html><head><title>T</title><script>evil()</script></head><body><main><p>Hello</p><a href="../b/c.html">C</a><a href="mailto:x@y">m</a></main></body></html>`, "http://localhost:9/a/x/index.html");
    expect(page.text).toContain("Hello");
    expect(page.text).not.toContain("evil");
    expect(page.links).toEqual([{ url: "http://localhost:9/a/b/c.html", text: "C" }]);
  });
});

describe("crawlCompany", () => {
  it("finds a buried hiring page by following ranked links, respecting robots.txt and path scope", async () => {
    const res = await crawlCompany(`${base}/acme/`, { allowPrivate: true });
    expect(res.reachable).toBe(true);
    expect(res.companyName).toBe("Acme Logistics");
    const urls = res.pages.map((p) => p.url);
    expect(urls).toContain(`${base}/acme/company/handbook/interviewing.html`);
    expect(res.hiringPageUrl).toBe(`${base}/acme/company/handbook/interviewing.html`);
    expect(res.processDescribed).toBe(true);
    expect(urls.some((u) => u.includes("/private/"))).toBe(false); // robots.txt
    expect(urls.some((u) => u.includes("/globex/"))).toBe(false); // other company on same host
    expect(urls.some((u) => u.includes("twitter.com"))).toBe(false); // off-site
  });

  it("reports honestly when a site has no hiring page", async () => {
    const res = await crawlCompany(`${base}/globex/`, { allowPrivate: true });
    expect(res.reachable).toBe(true);
    expect(res.hiringPageUrl).toBeNull();
    expect(res.processDescribed).toBe(false);
  });

  it("records an unreachable site instead of throwing", async () => {
    const res = await crawlCompany(`${base}/does-not-exist/`, { allowPrivate: true });
    expect(res.reachable).toBe(false);
    expect(res.error?.code).toBe("COMPANY_UNREACHABLE");
    const bad = await crawlCompany("not a url at all", { allowPrivate: true });
    expect(bad.reachable).toBe(false);
  });

  it("blocks localhost when private hosts are not allowed", async () => {
    const res = await crawlCompany(`${base}/acme/`, { allowPrivate: false });
    expect(res.reachable).toBe(false);
    expect(res.error?.code).toBe("BLOCKED_URL");
  });
});
