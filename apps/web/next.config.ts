import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { existsSync } from "node:fs";
import path from "node:path";

// Next already loads apps/web/.env* (see .env.example). The monorepo also keeps one .env at
// the repo root (shared with the API and docker compose); load it as a fallback so `pnpm dev`
// works without a web-only file. loadEnvFile never overwrites a variable that is already set.
// (Not @next/env's loadEnvConfig: Next has already called it, and it returns that cached result.)
const ROOT_ENV_FILE = path.resolve(__dirname, "../../.env");
if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);

/** The API `pnpm dev` talks to when nothing else is configured. */
const LOCAL_API_URL = "http://localhost:4000";

/**
 * The API the browser talks to: NEXT_PUBLIC_API_BASE_URL (apps/web/.env.local or Vercel),
 * else API_BASE_URL from the root .env, else the local API, but only outside production
 * builds. A production build with nothing set, or a Vercel build pointing at localhost,
 * fails here instead of shipping a bundle that calls the visitor's own machine.
 */
function resolveApiBaseUrl(phase: string): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL;
  if (!configured) {
    if (phase === PHASE_PRODUCTION_BUILD) {
      throw new Error(
        "NEXT_PUBLIC_API_BASE_URL is not set. Set it to https://<API_DOMAIN> " +
          "(Vercel: Project Settings -> Environment Variables; locally: apps/web/.env.local).",
      );
    }
    return LOCAL_API_URL;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`NEXT_PUBLIC_API_BASE_URL is not a valid URL: "${configured}"`);
  }
  const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (process.env.VERCEL && isLocalHost) {
    throw new Error(`NEXT_PUBLIC_API_BASE_URL points at ${configured} on Vercel. Set it to https://<API_DOMAIN>.`);
  }
  // fetch paths start with "/", so drop any trailing slash to avoid "//health".
  return configured.replace(/\/+$/, "");
}

export default function config(phase: string): NextConfig {
  return {
    env: {
      // Inlined into the browser bundle; read through lib/env.ts.
      NEXT_PUBLIC_API_BASE_URL: resolveApiBaseUrl(phase),
    },
    // The dev badge sits on top of the graph canvas; the overlay still shows errors.
    devIndicators: false,
    // Transpile @theme-toggles/react since it ships raw .tsx source files
    transpilePackages: ["@theme-toggles/react"],
  };
}
