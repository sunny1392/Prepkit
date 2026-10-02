# PrepKit — interview prep from a job description

Paste a job description, give the company's website and the number of days until the interview. PrepKit reads the posting, crawls the company site to find what they do and how they hire, searches public discussion of their interviews, and builds a structured kit: a company brief, a role breakdown, a categorised question bank, flashcards and a day-by-day study schedule. You can reshape every part of it, regenerate any one section without losing your edits, and practise against the flashcards.

- **Live app:** `<your Vercel URL>` · **API:** `<your Render URL>/health`
- **Batch entry point:** `npm run evaluate -- --input cases.json --output kits.json`

---

## Contents

1. [Stack](#stack)
2. [Setup — local, deployed, batch](#setup)
3. [LLM provider and model](#llm-provider-and-model)
4. [Architecture](#architecture)
5. [Retrieval approach and sources](#retrieval-approach-and-sources)
6. [How research and generation are sequenced](#how-research-and-generation-are-sequenced)
7. [The second pass (coverage loop)](#the-second-pass-coverage-loop)
8. [Generated, edited and pinned state](#generated-edited-and-pinned-state)
9. [Schedule allocation](#schedule-allocation)
10. [Practice mode](#practice-mode)
11. [Creative feature: readiness gap report](#creative-feature-readiness-gap-report)
12. [Edge cases and failure handling](#edge-cases-and-failure-handling)
13. [Security](#security)
14. [Design decisions, trade-offs and known limitations](#design-decisions-trade-offs-and-known-limitations)

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 15 (App Router) + Tailwind CSS**, `@dnd-kit` | Preferred stack. dnd-kit gives drag *and* keyboard sorting with screen-reader announcements. |
| Backend | **Node.js + Express**, TypeScript, run with `tsx` | Preferred stack. No build step, so the same TS source runs in tests, the API and the batch command. |
| Database | **MongoDB** (Atlas free tier) via Mongoose | Preferred stack. A kit is naturally one document. |
| Validation | **Zod** | One schema validates model output, API requests and every kit before it is saved. |
| Scraping | `fetch` (undici) + **cheerio** + **robots-parser** | Company pages are server-rendered HTML in the overwhelming majority of cases. No headless browser, so it is light enough for free hosting. |
| Tests | **Vitest** + supertest | 69 tests across retrieval, extraction grounding, the LLM client, coverage, scheduling, validation, merge/regeneration, practice, the full pipeline and the HTTP API. |

The code is an npm-workspaces monorepo:

```
packages/core   all pipeline logic (no Express / Next imports) — shared by the API, the batch command and the browser
apps/api        Express: auth, kits, job runner, builder ops, regeneration, practice
apps/web        Next.js UI
scripts/        evaluate.ts (batch entry point), check-llm.ts, fixture-server.ts
fixtures/       local company sites + job descriptions used by tests and demos
```

`npm run evaluate` and the API both call the same `runPipeline()` from `packages/core`. There is no second implementation.

---

## Setup

Requires **Node 20+** (developed on Node 22).

### Install

```bash
git clone <repo> && cd prepkit
npm install
cp .env.example .env      # then fill in at least one LLM key
npm run check:llm         # sends one tiny request per configured model and shows which work
```

### Batch entry point (Section 9)

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

- Input: an array of `{ id, jd, company_url, days }`. Output: the Appendix B envelope.
- Needs only an LLM key in the environment (or `.env`). It does not need MongoDB.
- Private and loopback hosts are allowed in this command (and only here), because evaluation sites may be served from `localhost`. Set `EVAL_ALLOW_PRIVATE_HOSTS=false` to turn that off.
- Cases run two at a time (`EVAL_CONCURRENCY`) and share one rate limiter. Each case gets a slice of a 14-minute total budget (`EVAL_BUDGET_MS`), so five cases finish inside fifteen minutes even if a provider stalls.
- One failing case is recorded as `failed` and the run continues. The output file is rewritten after every case, so a crash still leaves partial results.

Try it against the bundled fixture sites:

```bash
npm run fixtures &                     # serves fixtures/sites on http://localhost:8099
npm run evaluate -- --input fixtures/cases.json --output kits.json
```

Without an API key you can still exercise every step with the rule-based stand-in model (`LLM_PROVIDER_ORDER=mock`). It exists for tests and smoke runs; it is **not** a substitute for a model.

### Run the app locally

```bash
npm run dev:api     # http://localhost:4000 (no MONGODB_URI → in-memory store, data lost on restart)
npm run dev:web     # http://localhost:3000 (proxies /api/* to API_URL)
npm test            # all tests
```

To try the app against the local fixture sites, set `ALLOW_PRIVATE_HOSTS=true` for the API.

### Deployed

| Piece | Where | Settings |
|---|---|---|
| Web | **Vercel** | Root directory `apps/web`. Env: `API_URL=https://<api>.onrender.com` |
| API | **Render** free web service (`render.yaml` blueprint) | Build `npm ci --include=dev`, start `npm run start:api`. Env: see below |
| DB | **MongoDB Atlas** M0 | Allow Render's egress (or 0.0.0.0/0) and put the URI in `MONGODB_URI` |

The browser only ever talks to the Vercel origin. Next.js rewrites `/api/*` to the API, so the session cookie is first-party and works in Safari, which blocks third-party cookies.

### Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | api, evaluate | OpenRouter key. Only `:free` models are used. |
| `OPENROUTER_MODELS` | api, evaluate | Comma-separated fallback chain of free models, tried in order. |
| `GEMINI_API_KEY` | api, evaluate | Google AI Studio key — the backup provider (optional). |
| `GEMINI_MODEL` | api, evaluate | Gemini model id (default `gemini-2.5-flash`). |
| `LLM_PROVIDER_ORDER` | api, evaluate | `openrouter,gemini` (default). Providers with no key are skipped. `mock` = offline stand-in. |
| `LLM_RPM` | api, evaluate | Requests-per-minute ceiling across all calls (default 15). |
| `ALLOW_PRIVATE_HOSTS` | api | `true` only for local demos against localhost sites. **Must be `false` when deployed.** |
| `CRAWL_MAX_PAGES` | api, evaluate | Page budget per company crawl (default 12). |
| `MONGODB_URI` | api | Mongo connection string. Required in production. |
| `JWT_SECRET` | api | Signs session tokens. The API refuses to start in production with the default value. |
| `CORS_ORIGIN` | api | Web origin(s), comma-separated. |
| `CROSS_SITE_COOKIES` | api | Only if the browser calls the API cross-site directly (normally `false`). |
| `JOB_CONCURRENCY` | api | Parallel generations per process (default 2). |
| `PORT` | api | Listen port. |
| `API_URL` | web | Where Next.js proxies `/api/*`. Server-side only. |

---

## LLM provider and model

**OpenRouter free models, with Google Gemini's free tier as a backup**, behind one provider-agnostic client (`packages/core/src/llm`).

- Default chain: `meta-llama/llama-3.3-70b-instruct:free` → `deepseek/deepseek-chat-v3-0324:free` → `qwen/qwen-2.5-72b-instruct:free` → `gemini-2.5-flash`.
- Free model availability changes often. Check https://openrouter.ai/models?max_price=0, set `OPENROUTER_MODELS`, and run `npm run check:llm`.

Why a backup provider? OpenRouter's free tier is about **20 requests a minute and 50 a day** on an account with no credits. A kit takes about 7–9 calls, so the graders' five cases plus one debugging run would exhaust the daily cap. Free models also start returning 429 upstream without warning.

The client handles all of this:

- One **sliding-window RPM limiter** per process, shared by every concurrent kit.
- **Per-target cooldowns** that honour `Retry-After`, with exponential backoff and jitter.
- **Failover**: a daily-quota 429 or an auth error retires that model for the rest of the run, and the next one in the chain is used.
- **Lenient JSON extraction**: strips code fences and surrounding prose, removes trailing commas, closes truncated output. Then Zod validation.
- One **repair retry** that feeds the validation error back to the model, before moving on to the next target.
- **Per-step and per-item validation**. A response with 9 good questions and 1 malformed one keeps the 9.

---

## Architecture

```
            ┌──────────── apps/web (Next.js) ────────────┐
 browser ──▶│ pages, builder, practice    /api/* rewrite  │──▶ apps/api (Express)
            │ useKitEditor: optimistic ops using the same │      auth · kits · ops · regenerate · practice
            │ pure functions as the server                │      JobRunner (in-process queue, resumes on boot)
            └─────────────────────────────────────────────┘      Store: MongoStore | MemoryStore
                                                                        │
                                                       packages/core ◀──┘◀── scripts/evaluate.ts
  retrieval/  url-guard · fetch-page · robots · clean · rank-links · crawl
  research/   discussion-search (HN Algolia, Reddit)
  llm/        client (limiter, failover, repair) · providers · prompts · json · mock
  steps/      extract-requirements · company-brief · generate-questions · generate-flashcards
  coverage/   computeCoverage · runCoverageLoop           (deterministic)
  schedule/   allocateSchedule                            (deterministic)
  kit/        schema (Zod, Appendix A) · validate · operations (pure mutations + merges) · regenerate
  practice/   orderSession · readinessReport              (deterministic)
  pipeline.ts orchestrates the steps and emits progress events
```

Concerns are separated as the brief asks:

- **Retrieval** never sees the model.
- **Extraction and generation** never fetch anything.
- **Scheduling and coverage** are plain functions.
- **Persistence** sits behind a `Store` interface: Mongo in production, in-memory for tests and DB-less runs.

**Long-running generation.** `POST /kits` returns `202` straight away and the work runs in a job queue.

- The UI polls `/kits/:id/status?since=n`, which returns only new progress events. Polling survives proxies, sleeping free-tier instances and flaky mobile networks, where server-sent events would be brittle.
- Job state lives in the database. If the server restarts mid-generation, the kit is re-queued on boot and rebuilt from its stored input (the pipeline is idempotent).
- **Double submission:** the same user posting the same description and company — normalised for whitespace, scheme and trailing slashes — gets the existing kit back (`deduped: true`). The UI offers "open existing" or "generate a fresh one".
- The job runner also ignores a second enqueue of a kit that is already running.

---

## Retrieval approach and sources

**Company site (`retrieval/crawl.ts`)** — a best-first crawl, not a list of paths:

1. Validate the URL (see [Security](#security)) and load `robots.txt`. Disallow rules and `Crawl-delay` are obeyed for our user agent.
2. Fetch the start URL, following redirects and re-validating every hop. Relative links are resolved against `<base href>` or the page URL, so any host works, including `http://localhost:8099/acme/`.
3. Collect every in-scope link the site exposes: anchors on fetched pages plus `sitemap.xml` (from robots.txt, or the root).
   - *In scope* means the same site.
   - When the company URL has a path, links must also stay under that path on the same host. `localhost:8099/acme/` never wanders into `/globex/`.
4. **Score each link** by keywords in its path and anchor text, with separate hiring and about weights:
   - `interview`, `how we hire` and `hiring` score highest.
   - `careers`, `jobs` and `join us` score high.
   - `handbook`, `people` and `values` score lower.
   - Negatives (login, legal, assets) and deep or query-heavy URLs are penalised.
5. Repeatedly fetch the **highest-scoring unvisited link**, up to 12 pages (at most 6 hiring and 4 about pages).
   - Links found *on* a hiring page get a context boost. That is how `careers → "our interview process"` is followed when the second hop's URL says nothing.
   - A page whose *content* talks about interviews counts as hiring even if its URL didn't say so.
6. Every page that fails (404, timeout, wrong content type, too large, robots-disallowed) is recorded in `research.skipped_sources` and skipped.

The fixture test shows this in action. The Acme site buries its process at `/acme/company/handbook/interviewing.html`, linked from "Life at Acme". The crawl finds it without any path list.

**Public discussion (`research/discussion-search.ts`)** — free, key-less public APIs:

- **Hacker News via the Algolia API** (`hn.algolia.com/api/v1/search`).
- **Reddit's JSON search** (`reddit.com/search.json`).

Hits are kept only if they name the company (or its domain) **and** talk about hiring. Generic names like "Acme" otherwise pull in unrelated threads. The model is told these posts are anecdotal and may be about a different company, and any stage it takes from them is prefixed "Reported by candidates:". Glassdoor and Blind are not used because both prohibit automated access in their terms. Nothing found is a normal outcome and is reported in the kit.

---

## How research and generation are sequenced

The pipeline (`packages/core/src/pipeline.ts`) is a sequence of small steps. Each has typed input and output, its own prompt, its own validation and its own failure handling. Later steps depend on what earlier ones found.

| # | Step | Model? | Responsible for |
|---|---|---|---|
| 1 | Validate input | no | Description length, URL, `days` within 1–90. |
| 2a | **Extract requirements** | 1 call | Title, seniority, location, responsibilities, and requirements with `kind`, `priority` and a verbatim **evidence quote**. Runs in parallel with 2b. |
| 2a′ | **Ground requirements** | no | Drops any requirement whose quote isn't in the posting (≥80% word overlap) or whose text embellishes the quote. Drops items under Benefits/Perks/About-us headings. **Corrects must/nice from the posting's own wording**: "nice to have", "bonus", "a plus" and "preferred" lines and headings win over the model. Assigns stable ids `r1..rn` in posting order. |
| 2b | **Crawl company site** | no | See above. Pasted text needs no retrieval; only the company URL is crawled. |
| 3 | **Search public discussion** | no | Needs the company name, from the posting or the site's metadata, so it runs after 2a/2b. |
| 4 | **Company brief + interview process** | 1 call, or none | Only from retrieved text. Sources are filtered to URLs we actually fetched. A stage with no traceable source is dropped. `found` can only be true if the crawler or the search supplied evidence of a process. **If nothing was retrieved, no model call is made** and an honest "we couldn't find anything" brief is written by code. |
| 5 | **Plan categories** | no | Code decides which question categories to generate and from which requirements (below). |
| 6 | **Generate questions**, one call per category | 3–4 calls | Each category has its own instructions and only the requirements routed to it. |
| 7 | **Coverage loop** | 0–2 calls | See next section. |
| 8 | **Flashcards** | 1 call | Plus a deterministic top-up so every must-have has a card. Skipped when there are no requirements. |
| 9 | **Schedule** | no | Deterministic allocator. |
| 10 | **Validate** | no | Zod and referential checks. An invalid kit is never saved or emitted. |

**How findings change the questions** (`planCategories`):

- *Technical* questions come from `technical` and `domain` requirements. *Behavioural* questions come from `behavioural` requirements. They are separate calls with different instructions, which answers the brief's "five years of React vs mentoring" point directly.
- *System design* is generated only if the company's published or reported process has a design or architecture round (4 questions), or the role is senior and technical (2 questions). Otherwise it is skipped, and the progress view says why.
- A published *values/culture* round adds a behavioural and a company-fit question.
- The published stages (take-home, pairing, system design…) are passed to every question prompt as the formats to tailor to. With no published process, the prompt says "do not assume any particular format".

A typical kit costs **7–9 model calls**.

---

## The second pass (coverage loop)

Coverage is decided by code (`coverage/coverage.ts`): a requirement is covered if and only if some question lists its id in `requirement_ids`. The model cannot claim coverage either. Ids it returns are filtered down to the ids that were actually sent to it.

```
check  →  uncovered? → generate targeted questions for exactly those ids (1 call) → check again
```

The loop stops when:

- nothing is uncovered, or
- a fill pass made **no progress** (asking the same model the same thing again just burns quota), or
- **2 fill passes** have run.

Any **must-have** still uncovered then gets a deterministic template question (`origin: "fallback"`, shown with a "Template" badge), so a kit never ships with an uncovered must. Nice-to-haves that remain uncovered are left honestly in `coverage.uncovered_requirement_ids`. `coverage.passes` counts coverage checks.

*Why 2 fill passes?* In practice a targeted second call closes nearly all gaps. A third call rarely helps and costs about 10% of a day's free quota per kit. The deterministic fallback is what guarantees the must-have invariant, not the number of passes.

---

## Generated, edited and pinned state

Every editable item — question, flashcard, company brief, schedule — carries:

```ts
meta: { origin: "generated" | "user" | "fallback", edited: boolean, pinned: boolean, generation_id, updated_at }
```

- **Preserved** = `origin === "user" || edited || pinned`.
- **Regenerating a section replaces only the untouched generated or fallback items in that section.** Preserved items keep their positions, new items are added after them, and every other section is left exactly as it was. This is tested.
- Editing, moving or reordering an item counts as a hand edit, so it survives regeneration. Pinning protects an item without editing it.
- The **brief and the schedule** are single items. A pinned one can't be regenerated (unpin first). An edited one asks for confirmation, because the user explicitly asked to replace it.
- **Ids are never reused.** A high-water mark (`id_seq`) means a deleted `q5` is never handed out again, so schedule references and practice history stay valid.
- **Practice history** is stored beside the kit, not inside it, so no regeneration can reset it.

**Concurrency — the hard part.**

- Every write bumps a `version`. Builder operations carry the version they were based on, and the store does an atomic compare-and-set.
- **Regeneration runs in two phases** (`kit/regenerate.ts`):
  1. Generate drafts from a snapshot. This is slow, and the kit is not locked.
  2. **Merge the drafts into the latest stored kit**, with compare-and-set, retrying the merge if the user saved in between.

  Edits made *while* the model is running are therefore kept. An API test holds the model mid-regeneration, edits the brief, then releases it, and checks that the edit survived.
- On the client, `useKitEditor` applies every operation **locally first**, using the same pure functions from `@prepkit/core` that the server uses. Edits feel instant.
  - Text fields debounce (700 ms) or commit on blur, so there is no request per keystroke.
  - Operations are queued and sent in batches, one request at a time.
  - On `409` the client takes the server's kit, **replays its unsent operations on top** (a rebase), and retries.
  - A save indicator shows Saving… / Saved / Merging / Not saved.

---

## Schedule allocation

`schedule/allocate.ts` is deterministic, and the model is not involved.

1. **Order** questions by priority: covers a must-have (100) → difficulty (×10) → system design (+1, usually the longest prep). Ties keep kit order.
2. **Study days**:
   - If there are at least as many questions as days, every day is a study day.
   - Otherwise the first `ceil(days/2)` days are study days (at most one per question) and the rest are review days.
3. **Split** the ordered list into contiguous, minute-balanced chunks over the study days (10/20/30 integer minutes for difficulty 1/2/3). Every chunk is non-empty. Hard and must-have material therefore lands **first**, never the night before.
4. **Review days** revisit questions on a spaced schedule (1, 3, 7, 14 and 30 days after first study), must-haves first. A 60-day plan has real content every day.
5. With 3 or more days, the **final day** also re-runs the top must-have questions.

Tested guarantees, for 1, 2, 5, 7, 14, 30 and 60 days and for fewer questions than days:

- exactly `days` days, numbered 1..n
- every question appears at least once
- every must-have with a question is scheduled
- integer minutes
- deterministic output

A 1-day plan puts everything on day 1 with an honest total. The user can edit a day's focus or minutes, which marks the schedule edited, or rebuild it.

---

## Practice mode

- Flashcards one at a time. **Space** or **Enter** reveals the answer; **1 / 2 / 3** rates it (didn't know / shaky / confident).
- Progress shows covered versus not-yet-practised cards, plus confident, shaky and weak counts.
- **Next-session order** is a **confidence-weighted sort**: unseen cards first, then lowest confidence, then least recently reviewed. Sessions are capped at 15 cards.

*Why not SM-2?* Spaced-repetition intervals optimise recall over weeks or months. Interview prep is usually 1–14 days, where the useful question is "what am I worst at right now?". Unseen cards go first because an unknown confidence is the biggest risk. The schedule already handles spacing at the question level.

---

## Creative feature: readiness gap report

**Problem:** the night before an interview, people don't need more material. They need to know where they would stumble. A question bank doesn't tell you that.

The **Readiness** tab answers "if they asked about this requirement tomorrow, could I answer?" for every requirement, must-haves first, worst first:

- 🔴 no question or card covers it, nothing practised yet, or average confidence below 1.75
- 🟠 some linked cards unpractised, or confidence below 2.5
- 🟢 every linked card practised with average confidence of at least 2.5

It uses data the kit already has (coverage and practice ratings), so it needs **no model call** and stays exact as the user edits. A "Practise weakest first" button jumps straight into a session ordered by the same logic.

There is also a **Print** button with print styles for a paper copy of any tab.

---

## Edge cases and failure handling

| Case | What happens |
|---|---|
| Invalid URL, 404 or timeout | The fetch retries twice on transient errors (not on 404), then the crawl reports `COMPANY_UNREACHABLE`. The kit is still built from the posting: `pages_used: []`, an honest brief, and a research note. Status stays `ok`. |
| No hiring or about page | `research.hiring_page_found: false`. `interview_process.found` is false and has no stages. Questions don't assume a format. A note says so. |
| Two-line posting | Few requirements (whatever is grounded), `research.thin_jd: true`, a smaller kit and a banner in the UI. Nothing is padded. Grounding drops invented requirements. |
| No public discussion | Recorded as a note. It is not fatal. |
| Invalid JSON or incomplete output | Repair, re-validation, a repair prompt, then failover. Invalid items are dropped individually. A failed category is filled by the coverage loop. A failed brief or flashcard step falls back to deterministic content. The final kit is always schema-validated. |
| Rate limit or brief provider failure | Shared limiter, `Retry-After`, backoff, model and provider failover. The case is `failed` with `LLM_UNAVAILABLE` only if *no* provider can answer. |
| Same description and company twice | Deduplicated per user by a normalised hash. The UI offers "open existing" or "generate fresh". |
| 1-day or 60-day schedule | Tested. Accepts 1–90 days. |
| Server restart mid-generation | The kit is re-queued on boot and rebuilt from its stored input. |
| Expired or invalid session | `401 SESSION_EXPIRED`. The UI returns to sign-in and remembers the page you were on. |
| Edit conflict (two tabs, or a regeneration landing) | `409` with the current kit. The client rebases its pending operations. |

`failed` is reserved for "no kit could be produced at all": bad input, no LLM available, or a time budget exceeded.

---

## Security

- **URL validation before every fetch**, re-checked on every redirect hop:
  - only http/https, no embedded credentials
  - DNS-resolves the host and **rejects private, loopback, link-local, CGNAT, multicast and IPv4-mapped-IPv6 addresses** (including `169.254.169.254`)
  - also rejects `localhost`, `*.local` and `*.internal`

  This is enforced in production. Private hosts are allowed only by explicit opt-in (`ALLOW_PRIVATE_HOSTS` for local dev, and the evaluate command).
- **Content types**: HTML, XHTML and plain text only (XML for sitemaps, JSON for the discussion APIs).
- **Size and time limits**: 2 MB per response, streamed and aborted past the cap; a 10-second timeout; at most 5 redirects.
- **Per-host politeness**: one request per host at a time with a gap between them, and robots.txt `Crawl-delay` is obeyed.
- **Prompt injection**:
  - Every piece of third-party text — the pasted posting, crawled pages, forum posts — is wrapped in `<untrusted_*>` tags, with any attempt to close the tag neutralised.
  - The system prompt says such content is data and its instructions must be ignored.
  - More importantly, **the model has no power to act**. It can't choose URLs to fetch, ids, coverage or what gets saved; code filters its output to known ids and fetched URLs and validates the shape.
  - The Acme fixture contains a hidden "ignore all previous instructions" paragraph, and a test asserts it reaches the model only inside the untrusted block.
- **Auth**:
  - bcrypt password hashes
  - JWT in an **httpOnly, SameSite=Lax, Secure** cookie that JavaScript can't read
  - login and registration are rate-limited, and login returns the same error whether or not the email exists
  - every kit query is scoped by `userId`; another user's kit returns 404, not 403, so existence isn't leaked
- **API hygiene**: `helmet`, CORS allowlist, a 1 MB body limit, Zod validation on every request body, and structured errors without stack traces.

---

## Design decisions, trade-offs and known limitations

**Decisions I'd defend**

- **The model writes; code decides.** Must vs nice, coverage, which categories exist, scheduling, practice order, what counts as a source and whether a process was "found" are all code. The model is used where language is needed and nowhere else. That makes the automated checks (extraction, coverage, schedule) properties of the code rather than luck.
- **Grounding over prompting** for requirement extraction. Telling a model "don't invent" helps; *checking* its quote against the posting is what actually stops invention.
- **Two-phase regeneration** (generate from a snapshot, merge into the latest) instead of locking the kit for 20 seconds. The user never waits and never loses an edit.
- **Optimistic UI using the server's own pure functions**, so local and server results match by construction.
- **Polling over server-sent events** for progress. It is boring, but robust on free hosting and through proxies.

**Trade-offs and limitations**

- The **job queue is in-process**. With several API instances you'd want a real queue (BullMQ with Redis). Kits do resume after a restart, but a crash mid-step repeats that kit's model calls.
- **JavaScript-rendered company sites** (content loaded client-side) yield little text. A headless browser would fix that at a large cost in memory and time on free tiers. The kit reports thin research honestly instead.
- **Discussion search** covers Hacker News and Reddit only. Reddit sometimes rate-limits anonymous requests; that is recorded and skipped. There is no Glassdoor or Blind (their terms prohibit scraping).
- **DNS rebinding**: the address check resolves before connecting. Pinning the resolved IP for the connection would close the small remaining gap.
- **Free-tier quality varies.** Smaller free models write blander questions. The structure, coverage and schedule guarantees hold regardless, because code enforces them.
- **Cross-category moves** use a "Move to" select rather than drag-between-columns. It is keyboard- and phone-friendly, and drag reordering *within* a category is supported by mouse, touch and keyboard.
- Render's free tier **sleeps when idle**, so the first request after a while takes about 30–50 seconds.

---

## Tests

```bash
npm test
```

| Area | File |
|---|---|
| URL guard, link ranking, HTML cleaning, crawl (buried hiring page, robots, path scope, unreachable, blocked) | `packages/core/test/retrieval.test.ts` |
| Requirement grounding, must/nice correction, benefits dropping | `extraction.test.ts` |
| JSON repair, failover, Retry-After, repair prompt, limiter | `llm.test.ts` |
| Coverage computation and the loop (progress stop, fallback, throwing pass, cap) | `coverage.test.ts` |
| Schedule invariants across 1–60 days, front-loading, review days, determinism | `schedule.test.ts` |
| Kit schema and referential validation | `validate.test.ts` |
| Regeneration merge preserves user work; builder operations | `operations.test.ts` |
| Practice ordering, readiness | `practice.test.ts` |
| Full pipeline on fixture sites: acme (process), stub posting + no hiring page, unreachable + 60 days, prompt-injection containment | `pipeline.test.ts` |
| HTTP API: auth, isolation, dedupe, version conflicts, regeneration during a concurrent edit, practice | `apps/api/test/api.test.ts` |
