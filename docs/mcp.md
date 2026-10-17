# Keystone MCP server

Keystone exposes its knowledge graph as an [MCP](https://modelcontextprotocol.io) server, so any
MCP client (Claude Desktop, the MCP Inspector, Keystone's own agent) can ask who knows a system,
where the company is exposed, what breaks if someone leaves, why a decision was made, and which
documents are out of date, with the artifact ids to cite.

Two transports, same tools:

| Transport | How to reach it |
| --- | --- |
| Streamable HTTP (stateless) | `POST http://localhost:4000/mcp` while the API runs (`pnpm dev`) |
| stdio | `pnpm --silent mcp:stdio` (builds the API, then runs `node dist/mcp/stdio.js`) |

Both need FalkorDB running (`docker compose up -d`) with the `apex` graph built, and read the
repo-root `.env`. `search_knowledge` embeds the question with the configured LLM provider
(cached), so it needs a key in `.env`; every other tool only reads the graph.

## Tools

| Tool | Arguments | Use it for |
| --- | --- | --- |
| `search_knowledge` | `question`, `k?` | What documents say: passages with artifact id, title, type, day, authors |
| `who_knows` | `system` | The five strongest experts on a system, scores and evidence; suggests names if unknown |
| `bus_factor` | `minScore?` | Systems with 0, 1 or 2 experts (orphaned, critical, watch) and counts per level |
| `bridge_people` | | The ten people who connect teams (betweenness on collaboration) |
| `simulate_departure` | `person` | What breaks if someone leaves: orphaned systems, tickets, pages, connectors |
| `trace_decision` | `system` | A system's decisions, newest first, with source artifacts and what they replaced |
| `find_stale_docs` | | Pages that still state a decision a later one replaced |
| `list_systems` | | Core systems with mention counts, to find exact names |
| `list_people` | `activeOnly?` | People with department and activity, to find exact names |
| `draft_handover`, `propose_reassignment`, `create_runbook_task` | | Not available yet (return `not_implemented`) |

Every tool answers with one JSON text block in the same envelope:

```json
{ "data": { ... }, "evidence": ["CONF-ENG-443", "ORG-212"], "graphPath": { "nodes": [], "edges": [] } }
```

`evidence` holds the artifact ids that support `data` (cite them); `graphPath` (optional) is a
small graph to draw. A failed call (for example simulating someone who has already left) is an
MCP tool error whose text is the same envelope with `data: null` and an `error` message.

## Claude Desktop

Add this to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`), replacing both paths, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "keystone": {
      "command": "/ABSOLUTE/PATH/TO/pnpm",
      "args": ["--silent", "--dir", "/ABSOLUTE/PATH/TO/KeyStone/apps/api", "mcp:stdio"],
      "env": { "PATH": "/ABSOLUTE/PATH/TO/node/bin:/usr/local/bin:/usr/bin:/bin" }
    }
  }
}
```

- Use absolute paths: Claude Desktop does not start servers with your shell's `PATH`. Find
  pnpm with `which pnpm` and node's folder with `dirname "$(which node)"`; the `PATH` entry lets
  pnpm find node (needed with nvm and similar version managers).
- `--silent` matters: stdout carries MCP messages only, and pnpm would otherwise print a header
  there. The server writes all of its logs to stderr (Claude Desktop shows them in its MCP log).
- The first start compiles the API (a few seconds).

## MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) lists the tools and lets
you call them by hand.

Over HTTP, with the API running:

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector, choose transport **Streamable HTTP**, URL `http://localhost:4000/mcp`, and
**Connect**. Then open **Tools**, **List Tools**, pick a tool, fill in the arguments and **Run**.

Over stdio (the Inspector starts the server itself), from the repo root:

```bash
npx @modelcontextprotocol/inspector pnpm --silent --dir apps/api mcp:stdio
```

## Quick check from the command line

```bash
pnpm mcp:check            # Streamable HTTP: lists the tools and calls the read tools on apex
pnpm mcp:check --stdio    # the same through the stdio server
```
