import { fetchPage } from "../retrieval/fetch-page.js";
import { PrepError } from "../util/errors.js";

export interface DiscussionSnippet {
  source: "hackernews" | "reddit";
  url: string;
  title: string;
  text: string;
}

export interface DiscussionResult {
  snippets: DiscussionSnippet[];
  searched: string[];
  failures: Array<{ source: string; reason: string }>;
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();

function relevant(text: string, company: string, domain: string): boolean {
  const t = text.toLowerCase();
  const name = company.toLowerCase().trim();
  if (!name || name.length < 2) return false;
  const nameHit = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t);
  const domainHit = domain ? t.includes(domain.toLowerCase()) : false;
  return (nameHit || domainHit) && /interview|hiring|recruit|onsite|take[- ]home|offer/.test(t);
}

/**
 * Search public discussion of a company's interview process. Uses free,
 * key-less public APIs: Hacker News (Algolia) and Reddit's JSON search.
 * Every failure is recorded, never thrown; "nothing found" is a valid result.
 * Hits are filtered to ones that name the company AND talk about hiring,
 * because a generic name (e.g. "Acme") otherwise matches unrelated threads.
 */
export async function searchDiscussions(company: string, companyUrl: string, opts: { timeoutMs?: number } = {}): Promise<DiscussionResult> {
  const result: DiscussionResult = { snippets: [], searched: [], failures: [] };
  if (!company.trim()) return result;
  let domain = "";
  try {
    const host = new URL(companyUrl).hostname.replace(/^www\./, "");
    domain = /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(host) ? "" : host;
  } catch {
    /* ignore */
  }
  const q = `"${company}" interview`;
  const common = { allowPrivate: false, retries: 1, timeoutMs: opts.timeoutMs ?? 8000, accept: ["application/json"] };

  const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=(story,comment)&hitsPerPage=20`;
  result.searched.push(hnUrl);
  try {
    const page = await fetchPage(hnUrl, common);
    const data = JSON.parse(page.body) as { hits: Array<Record<string, string | null>> };
    for (const h of data.hits ?? []) {
      const text = stripTags(h.comment_text ?? h.story_text ?? "");
      const title = stripTags(h.title ?? h.story_title ?? "");
      if (!relevant(`${title} ${text}`, company, domain)) continue;
      result.snippets.push({
        source: "hackernews",
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title,
        text: text.slice(0, 700),
      });
    }
  } catch (err) {
    result.failures.push({ source: "hackernews", reason: err instanceof PrepError ? err.message : String(err) });
  }

  const redditUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=15&sort=relevance`;
  result.searched.push(redditUrl);
  try {
    const page = await fetchPage(redditUrl, common);
    const data = JSON.parse(page.body) as { data?: { children?: Array<{ data: Record<string, string> }> } };
    for (const c of data.data?.children ?? []) {
      const d = c.data;
      const text = stripTags(d.selftext ?? "");
      if (!relevant(`${d.title} ${text}`, company, domain)) continue;
      result.snippets.push({ source: "reddit", url: `https://www.reddit.com${d.permalink}`, title: d.title, text: text.slice(0, 700) });
    }
  } catch (err) {
    result.failures.push({ source: "reddit", reason: err instanceof PrepError ? err.message : String(err) });
  }

  result.snippets = result.snippets.slice(0, 8);
  return result;
}
