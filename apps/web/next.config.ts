import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import path from "node:path";

// The monorepo keeps one .env at the repo root (shared with the API and
// docker compose). Load it here so `pnpm dev` in apps/web sees the same values.
loadEnvConfig(path.resolve(__dirname, "../.."));

const nextConfig: NextConfig = {
  env: {
    // Exposed to the browser: the only API the web app talks to.
    NEXT_PUBLIC_API_BASE_URL: process.env.API_BASE_URL ?? "http://localhost:4000",
  },
  // The dev badge sits on top of the graph canvas; the overlay still shows errors.
  devIndicators: false,
  // Transpile @theme-toggles/react since it ships raw .tsx source files
  transpilePackages: ["@theme-toggles/react"],
};

export default nextConfig;
