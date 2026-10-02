/**
 * Link ranking for the company crawl. Nothing here is a list of paths to try:
 * we score links the site actually exposes (anchors, sitemap) by the words in
 * their path and anchor text, then the crawler fetches best-first.
 */

export type PageKind = "hiring" | "about" | "other";

interface Signal {
  re: RegExp;
  weight: number;
}

const HIRING: Signal[] = [
  { re: /interview(s|ing)?\b/, weight: 6 },
  { re: /hiring|recruit(ing|ment)?/, weight: 5 },
  { re: /how[- _]?we[- _]?hire/, weight: 6 },
  { re: /careers?|jobs?\b|join[- _]?(us|the[- _]?team)?|work[- _]?(with|at)[- _]?us|open[- _]?(roles|positions)|vacanc/, weight: 4 },
  { re: /process|candidate|take[- _]?home|onboarding/, weight: 2 },
  { re: /handbook|people|talent|culture|values/, weight: 1.5 },
  { re: /engineering|eng[- _]?blog|tech[- _]?blog/, weight: 1 },
];

const ABOUT: Signal[] = [
  { re: /about|who[- _]?we[- _]?are|our[- _]?story|company\b/, weight: 5 },
  { re: /mission|values|team|leadership/, weight: 2.5 },
  { re: /product|platform|solutions?|customers|what[- _]?we[- _]?do|features/, weight: 2 },
];

const NEGATIVE = /(login|signin|sign-in|signup|register|cart|checkout|privacy|terms|cookie|legal|press-kit|status\.|\/tag\/|\/tags\/|\/category\/|\/page\/\d+|\/author\/|\.(pdf|png|jpe?g|gif|svg|zip|mp4|webp|ico|css|js|xml|json)$)/i;
const LOCALE_PREFIX = /^\/(?:[a-z]{2}(?:-[a-z]{2})?)\//i;

function textOf(url: URL, anchor: string): string {
  const path = decodeURIComponent(url.pathname.replace(LOCALE_PREFIX, "/")).toLowerCase();
  return `${url.hostname.split(".")[0]} ${path} ${anchor.toLowerCase()}`;
}

function score(signals: Signal[], hay: string): number {
  return signals.reduce((s, sig) => (sig.re.test(hay) ? s + sig.weight : s), 0);
}

export interface ScoredLink {
  url: string;
  text: string;
  hiring: number;
  about: number;
  score: number;
  kind: PageKind;
}

export function scoreLink(rawUrl: string, anchor: string): ScoredLink {
  const url = new URL(rawUrl);
  const hay = textOf(url, anchor);
  if (NEGATIVE.test(url.pathname) || NEGATIVE.test(url.hostname + "/")) {
    return { url: rawUrl, text: anchor, hiring: 0, about: 0, score: -10, kind: "other" };
  }
  const hiring = score(HIRING, hay);
  const about = score(ABOUT, hay);
  // Deep, query-heavy URLs (e.g. individual blog posts, filtered job lists) are worth less.
  const depth = url.pathname.split("/").filter(Boolean).length;
  const penalty = Math.max(0, depth - 3) * 0.75 + (url.search ? 1 : 0);
  const best = Math.max(hiring, about);
  const kind: PageKind = best <= 0 ? "other" : hiring >= about ? "hiring" : "about";
  return { url: rawUrl, text: anchor, hiring, about, score: best - penalty, kind };
}

export function rankLinks(links: Array<{ url: string; text: string }>): ScoredLink[] {
  return links.map((l) => scoreLink(l.url, l.text)).sort((a, b) => b.score - a.score);
}

/** Does a page's own content look like it describes the hiring/interview process? */
export function hiringContentScore(text: string): number {
  const t = text.toLowerCase();
  const terms = ["interview", "hiring process", "take-home", "take home", "system design", "technical screen", "recruiter", "onsite", "pair programming", "final round", "offer", "application process", "stages"];
  return terms.reduce((s, term) => s + (t.includes(term) ? 1 : 0), 0);
}
