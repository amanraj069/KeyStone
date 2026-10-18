/**
 * Every setting the web app reads from the environment, in one place. Values come from
 * apps/web/.env.local (copy apps/web/.env.example), the repo-root .env, or the Vercel
 * project settings; next.config.ts resolves and validates them at build time.
 *
 * Read process.env.NEXT_PUBLIC_* by its full literal name: Next inlines only those exact
 * expressions into the browser bundle.
 */

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
if (!apiBaseUrl) {
  // next.config.ts always sets it, so this only fires if that config was bypassed.
  throw new Error("NEXT_PUBLIC_API_BASE_URL is not set. Copy apps/web/.env.example to apps/web/.env.local.");
}

export const env = {
  /** Base URL of the Keystone API, without a trailing slash. */
  apiBaseUrl,
} as const;
