/** npm run check:llm — sends one tiny JSON request through each configured target so you can see which keys/models work. */
import { installProxyFromEnv, LLMClient, RateLimiter } from "@prepkit/core";
import { geminiTarget, openRouterTarget } from "@prepkit/core";
try { process.loadEnvFile?.(".env"); } catch { /* optional */ }
installProxyFromEnv();
const env = process.env;
const targets = [
  ...(env.OPENROUTER_API_KEY ? (env.OPENROUTER_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean).map((m) => openRouterTarget(env.OPENROUTER_API_KEY!, m)) : []),
  ...(env.GEMINI_API_KEY ? [geminiTarget(env.GEMINI_API_KEY, env.GEMINI_MODEL ?? "gemini-2.5-flash")] : []),
];
if (!targets.length) {
  console.error("No providers configured — set OPENROUTER_API_KEY and/or GEMINI_API_KEY in .env");
  process.exit(1);
}
for (const t of targets) {
  const llm = new LLMClient([t], new RateLimiter(60));
  const t0 = Date.now();
  try {
    await llm.json({ label: "check", system: "Reply with JSON only.", user: 'Return {"ok": true}', parse: (d) => { if ((d as { ok?: unknown }).ok !== true) throw new Error("unexpected reply"); return d; } });
    console.log(`OK    ${t.provider}/${t.model} (${Date.now() - t0}ms)`);
  } catch (e) {
    console.log(`FAIL  ${t.provider}/${t.model}: ${(e as Error).message.slice(0, 200)}`);
  }
}
