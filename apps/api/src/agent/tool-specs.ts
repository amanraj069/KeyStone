import type { ToolSpec } from './agent.types';

// MCP tool -> model function declaration. The JSON Schema comes from the MCP
// server (written once, as Zod, in keystone-mcp-server.ts) and is passed through.

/** OpenAI Chat Completions `tools`. */
export function toOpenAiTools(specs: readonly ToolSpec[]) {
  return specs.map((spec) => ({
    type: 'function' as const,
    function: { name: spec.name, description: spec.description, parameters: cleanSchema(spec.inputSchema) },
  }));
}

/** Gemini `functionDeclarations` (parametersJsonSchema accepts JSON Schema as is). */
export function toGeminiDeclarations(specs: readonly ToolSpec[]) {
  return specs.map((spec) => ({ name: spec.name, description: spec.description, parametersJsonSchema: cleanSchema(spec.inputSchema) }));
}

/** Drops the `$schema` keyword (model APIs do not want it) and makes sure there is a properties object. */
function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...schema };
  delete rest.$schema;
  return { type: 'object', properties: {}, ...rest };
}
