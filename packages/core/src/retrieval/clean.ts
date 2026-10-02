import * as cheerio from "cheerio";

export interface PageLink {
  url: string;
  text: string;
}

export interface CleanPage {
  url: string;
  title: string;
  description: string;
  siteName: string;
  headings: string[];
  text: string;
  links: PageLink[];
}

const NOISE = "script, style, noscript, svg, iframe, template, form, button, [aria-hidden=true], [hidden]";

/**
 * Turn raw HTML into plain text + absolute links. Links are resolved against
 * <base href> or the page URL, so relative links work on any host (including
 * localhost fixtures). Text is capped so one huge page can't blow the prompt.
 */
export function cleanHtml(html: string, pageUrl: string, maxChars = 8000): CleanPage {
  const $ = cheerio.load(html);
  const baseHref = $("base[href]").attr("href");
  let base: URL;
  try {
    base = new URL(baseHref ?? pageUrl, pageUrl);
  } catch {
    base = new URL(pageUrl);
  }

  const links: PageLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(href)) return;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    abs.hash = "";
    const key = abs.toString();
    if (seen.has(key)) return;
    seen.add(key);
    const text = ($(el).text() || $(el).attr("title") || $(el).attr("aria-label") || "").replace(/\s+/g, " ").trim();
    links.push({ url: key, text: text.slice(0, 120) });
  });

  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const description = ($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "").trim();
  const siteName = ($('meta[property="og:site_name"]').attr("content") ?? $('meta[name="application-name"]').attr("content") ?? "").trim();

  $(NOISE).remove();
  const headings = $("h1, h2, h3")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean)
    .slice(0, 40);

  // Prefer the main content region; fall back to body minus chrome.
  let root = $("main, article, [role=main]").first();
  if (!root.length) {
    $("nav, header, footer, aside").remove();
    root = $("body");
  }
  // Keep block boundaries as line breaks before extracting text.
  root.find("p, li, h1, h2, h3, h4, h5, h6, br, div, section, tr").each((_, el) => {
    $(el).append("\n");
  });
  const text = root
    .text()
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, maxChars);

  return { url: pageUrl, title, description, siteName, headings, text, links };
}

/** Best-effort company name from page metadata, falling back to the hostname. */
export function guessCompanyName(page: Pick<CleanPage, "siteName" | "title">, url: string): string {
  if (page.siteName) return page.siteName;
  if (page.title) {
    const parts = page.title.split(/\s[|\-–—:·]\s/).map((p) => p.trim()).filter(Boolean);
    const short = parts.sort((a, b) => a.length - b.length)[0];
    if (short && short.length <= 40) return short;
  }
  const u = new URL(url);
  const pathSeg = u.pathname.split("/").filter(Boolean)[0];
  const isLocal = /^(localhost|127\.|\[?::1)/.test(u.hostname);
  const label = isLocal && pathSeg ? pathSeg : u.hostname.replace(/^www\./, "").split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}
