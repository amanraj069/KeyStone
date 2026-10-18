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
| `search_knowledge` | `question`, `k?`, `fromDay?`, `toDay?` | What documents say: passages with artifact id, title, type, day, authors |
| `find_artifacts` | `people?`, `fromDay?`, `toDay?`, `types?`, `titleContains?`, `textContains?`, `limit?` | Locate a specific event or document by who was involved, day range, type, title or text |
| `get_artifact` | `id` | One document: everyone involved and how (with the day), linked documents in both directions, start of the text |
| `what_followed` | `id`, `days?`, `types?` | What happened after a document: linked documents and the same people's later documents; empty means nothing followed |
| `find_event` | `day`, `people?`, `description?`, `types?`, `tolerance?` | The documents of one event: everything within a few days, ranked by people involved, rare description words in title and text, named document type, day distance |
| `check_follow_up` | `id`, `kind`, `days?` | Verdict: did a response of a kind (postmortem, ticket, support_ticket, page, email, ...) follow, linked to the document? |
| `check_visibility` | `person`, `day`, `description`, `title?`, `eventPeople?`, `types?` | Verdict in one call: finds the event without the person asked about, then checks their involvement by that day |
| `check_involvement` | `person`, `ids`, `asOfDay?` | Verdict: was the person part of these documents by that day (any role, received, listed), or only of a linked one? |
| `check_causal_link` | `causes`, `effects` | Verdict: `linked` (up to three references / fixes), `likely` (no link, but within 5 days among the same people) or `no_evidence` |
| `who_knows` | `system` | The five strongest experts on a system, `relativeScore` (1 = the top expert) and evidence; suggests names if unknown |
| `bus_factor` | `minScore?` | Systems with 0, 1 or 2 experts (orphaned, critical, watch) and counts per level |
| `bridge_people` | | The ten people who connect teams (betweenness on collaboration) |
| `central_people` | | The ten people at the centre of the collaboration network (PageRank on `COLLAB`), with evidence |
| `how_connected` | `from`, `to` | Shortest chain between two people or systems (`algo.SPpaths`, both directions), its steps, and the documents each pair of colleagues shared |
| `simulate_departure` | `person` | What breaks if someone leaves: orphaned systems, tickets, pages, connectors |
| `trace_decision` | `system` | A system's decisions, newest first, with source artifacts and what they replaced |
| `find_stale_docs` | | Pages that still state a decision a later one replaced |
| `list_systems` | | Core systems with mention counts, to find exact names |
| `list_people` | `activeOnly?` | People with department and activity, to find exact names |
| `draft_handover` | `person` | Proposes a handover plan: reassignments, page reviews, runbook tasks |
| `propose_reassignment` | `ticketId`, `person`, `reason` | Proposes moving a ticket to a person |
| `create_runbook_task` | `system` | Proposes a runbook task for a system's single expert |
| `recall_memory` | `subjects` | Approved notes from colleagues (cite as `NOTE-…`), how often each subject was asked about, and the latest questions |

The three action tools only create proposals (`status: proposed`). Approving or rejecting is
not a tool: a person does it in Keystone (`POST /actions/:id/approve`), so an agent cannot
approve its own suggestions.

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
