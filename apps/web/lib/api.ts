import { ApiErrorSchema, HealthResponseSchema, type HealthResponse } from "@keystone/shared";

/** Base URL of the Keystone API, injected at build time by next.config.ts. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

/**
 * GET /health. The response is validated with Zod, because anything that
 * crosses the network is untrusted until parsed.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`, { signal, cache: "no-store" });
  const body: unknown = await response.json();

  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(body);
    throw new Error(apiError.success ? apiError.data.message : `API returned ${response.status}`);
  }
  return HealthResponseSchema.parse(body);
}
