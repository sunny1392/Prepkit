try {
  process.loadEnvFile?.(".env");
} catch {
  /* optional */
}
try {
  process.loadEnvFile?.("../../.env");
} catch {
  /* optional */
}

const env = process.env;
const isProd = env.NODE_ENV === "production";

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET === "change-me")) {
  throw new Error("JWT_SECRET must be set to a long random value in production.");
}

export const config = {
  port: Number(env.PORT ?? 4000),
  mongoUri: env.MONGODB_URI ?? "",
  jwtSecret: env.JWT_SECRET ?? "dev-only-secret",
  corsOrigins: (env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()),
  crossSiteCookies: env.CROSS_SITE_COOKIES === "true",
  isProd,
  /** Only for local development / demos against localhost fixture sites. Keep false when deployed. */
  allowPrivateHosts: env.ALLOW_PRIVATE_HOSTS === "true",
  jobConcurrency: Number(env.JOB_CONCURRENCY ?? 2),
  crawlMaxPages: Number(env.CRAWL_MAX_PAGES ?? 12),
  sessionDays: 7,
};
