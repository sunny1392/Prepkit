import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { heuristicMockTarget, LLMClient, mockTarget, RateLimiter } from "@prepkit/core";
import { createApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory-store.js";
import { startStaticServer } from "../../../packages/core/test/helpers/static-server.js";

const fixtures = join(__dirname, "..", "..", "..", "fixtures");
let site: Server;
let base: string;
let gate: Promise<void> | null = null; // lets a test hold the model mid-regeneration
const inner = heuristicMockTarget();
const llm = () => new LLMClient([mockTarget(async (req) => { if (gate) await gate; return inner.call(req); })], new RateLimiter(1000));

const store = new MemoryStore();
const { app, jobs } = createApp({ store, llm, allowPrivate: true, searchDiscussion: async () => ({ snippets: [], searched: [], failures: [] }) });

beforeAll(async () => {
  ({ server: site, url: base } = await startStaticServer(join(fixtures, "sites")));
});
afterAll(() => site.close());

async function signup(email: string) {
  const agent = request.agent(app);
  const r = await agent.post("/auth/register").send({ email, password: "correct-horse" });
  expect(r.status).toBe(201);
  return agent;
}

describe("auth", () => {
  it("rejects anonymous and invalid sessions", async () => {
    expect((await request(app).get("/kits")).body.error.code).toBe("UNAUTHENTICATED");
    const bad = await request(app).get("/kits").set("Cookie", "pk_session=garbage");
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("SESSION_EXPIRED");
  });
  it("registers, logs in, logs out", async () => {
    await signup("a@x.com");
    expect((await request(app).post("/auth/register").send({ email: "a@x.com", password: "correct-horse" })).status).toBe(409);
    expect((await request(app).post("/auth/login").send({ email: "a@x.com", password: "wrong-password" })).status).toBe(401);
    const agent = request.agent(app);
    expect((await agent.post("/auth/login").send({ email: "a@x.com", password: "correct-horse" })).status).toBe(200);
    expect((await agent.get("/auth/me")).body.user.email).toBe("a@x.com");
    await agent.post("/auth/logout");
    expect((await agent.get("/auth/me")).status).toBe(401);
  });
});

describe("kits", () => {
  const jd = readFileSync(join(fixtures, "jds", "senior-backend.txt"), "utf8");

  it("generates a kit, dedupes resubmission, isolates users, and preserves edits through regeneration", async () => {
    const alice = await signup("alice@x.com");
    const bob = await signup("bob@x.com");

    expect((await alice.post("/kits").send({ jd: "", company_url: "x", days: 3 })).body.error.code).toBe("VALIDATION_ERROR");
    expect((await alice.post("/kits").send({ jd, company_url: `${base}/acme/`, days: 61 + 30 })).status).toBe(400);

    const created = await alice.post("/kits").send({ jd, company_url: `${base}/acme/`, days: 4 });
    expect(created.status).toBe(202);
    const id = created.body.kit.id;
    const again = await alice.post("/kits").send({ jd: `  ${jd}  `, company_url: `${base}/acme`, days: 4 });
    expect(again.body.deduped).toBe(true);
    expect(again.body.kit.id).toBe(id);

    await jobs.idle();
    const status = await alice.get(`/kits/${id}/status`);
    expect(status.body.status).toBe("ready");
    expect(status.body.events.some((e: { step: string }) => e.step === "coverage")).toBe(true);

    expect((await bob.get(`/kits/${id}`)).status).toBe(404);
    expect((await bob.post(`/kits/${id}/ops`).send({ version: 1, ops: [{ op: "deleteQuestion", id: "q1" }] })).status).toBe(404);
    expect((await bob.get("/kits")).body.kits).toHaveLength(0);

    let { body } = await alice.get(`/kits/${id}`);
    let version = body.kit.version;
    const tech = body.kit.kit.questions.filter((q: any) => q.category === "technical");
    const edited = tech[0].id;
    // edit + add a hand-written question in one batch
    let r = await alice.post(`/kits/${id}/ops`).send({
      version,
      ops: [
        { op: "editQuestion", id: edited, patch: { prompt: "My edited technical question" } },
        { op: "addQuestion", question: { category: "technical", prompt: "My own question", requirement_ids: ["r1"] } },
      ],
    });
    expect(r.status).toBe(200);
    version = r.body.version;

    // stale version → 409 with the current kit
    const stale = await alice.post(`/kits/${id}/ops`).send({ version: version - 1, ops: [{ op: "deleteQuestion", id: edited }] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.version).toBe(version);

    // start regenerating "technical", hold the model, and edit the brief meanwhile
    let release!: () => void;
    gate = new Promise((res) => (release = res));
    const regen = alice.post(`/kits/${id}/regenerate`).send({ section: "questions:technical" }).then((x) => x);
    await new Promise((res) => setTimeout(res, 100));
    const busy = await alice.post(`/kits/${id}/regenerate`).send({ section: "questions:technical" });
    expect(busy.body.error.code).toBe("BUSY");
    r = await alice.post(`/kits/${id}/ops`).send({ version, ops: [{ op: "editBrief", patch: { summary: "Edited while regenerating" } }] });
    expect(r.status).toBe(200);
    gate = null;
    release();
    const done = await regen;
    expect(done.status).toBe(200);
    const kit = done.body.kit;
    expect(kit.company_brief.summary).toBe("Edited while regenerating"); // concurrent edit survived
    const prompts = kit.questions.map((q: any) => q.prompt);
    expect(prompts).toContain("My edited technical question");
    expect(prompts).toContain("My own question");
    expect(done.body.kept).toBe(2);
    expect(kit.questions.some((q: any) => q.id === tech[1].id)).toBe(false); // untouched generated one replaced

    // practice
    const card = kit.flashcards[0].id;
    let p = await alice.post(`/kits/${id}/practice`).send({ cardId: card, confidence: 1 });
    expect(p.body.progress.covered).toBe(1);
    expect(p.body.order.at(-1)).toBe(card); // seen card goes after unseen ones
    p = await alice.get(`/kits/${id}/practice`);
    expect(p.body.readiness.length).toBe(kit.role.requirements.length);
  });

  it("finishes a near-empty posting as a thin kit instead of failing", async () => {
    const agent = await signup("carol@x.com");
    const created = await agent.post("/kits").send({ jd: "Engineer wanted. Apply now.", company_url: `${base}/nowhere/`, days: 2 });
    await jobs.idle();
    const { body } = await agent.get(`/kits/${created.body.kit.id}`);
    expect(body.kit.status).toBe("ready");
    expect(body.kit.kit.research.thin_jd).toBe(true);
    expect(body.kit.kit.flashcards.length).toBeGreaterThan(0);
    expect(body.kit.kit.schedule.days).toHaveLength(2);
    expect((await agent.post(`/kits/${created.body.kit.id}/retry`)).body.error.code).toBe("BUSY");
  });
});
