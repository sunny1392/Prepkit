/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const nextConfig = {
  // The browser only ever talks to this origin; /api/* is proxied to the Express API.
  // That keeps the session cookie first-party (no third-party-cookie problems in Safari).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  // Pure kit operations are shared with the API for optimistic updates.
  transpilePackages: ["@prepkit/core"],
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  poweredByHeader: false,
};
export default nextConfig;
