# AI usage

Graph Hacks allows AI coding assistants as long as they are disclosed. This file says which AI tools were used,
what they produced, what I decided and did myself, and how the result was checked.

**In short:** Claude Code wrote most of the code, tests and docs. I chose the problem and the dataset, designed the
graph model and its Cypher queries, split the build into stages and wrote a brief for each one, made the modelling
calls when the data surprised us, reviewed every change before committing it, and deployed and ran the product myself.
Every commit in this repo was reviewed and pushed by me. Claude Code was not allowed to push, and I merged every pull request.

---

## 1. Tools

### Used to build Keystone

| Tool | What it was used for |
| --- | --- |
| **Claude Code** with **Claude Opus 5.5** (most sessions) and **Claude Sonnet 5** (some sessions) | Writing code, tests and docs from my stage briefs; running tests, the capability check and the benchmark; explaining failures; drafting commit messages, which I approved |
| `create-next-app` 15.5, `shadcn` CLI 4.21 | The Next.js template and shadcn/ui base components (code generators, not AI) |

### Used inside Keystone at runtime

These models are part of the product, not tools used to write it. Every call is Zod-validated and cached, so
`pnpm seed` rebuilds the whole graph with **zero** LLM calls.

| Model | Where |
| --- | --- |
| OpenAI `gpt-5-nano` | Extracting systems and decisions from documents; the agent's answers; the benchmark judge |
| OpenAI `text-embedding-3-small` | Chunk embeddings for the FalkorDB vector index |
| Gemini `gemini-3.7-flash`, `gemini-embedding-001` | Alternative provider (`USE_OPENAI=no`) |

The graph decides; the LLM writes the sentence. Expertise, bus factor, departure impact, staleness, the yes/no
verdicts and the citations all come from Cypher in FalkorDB (see the README, [*The graph does the work*](README.md#the-graph-does-the-work)).

---

## 2. Who did what

| Area | What I did | What Claude Code did |
| --- | --- | --- |
| **Product and scope** | Chose the problem (knowledge that walks out of the door), the tracks (Company Brain, Agents That Act on Connected Data) and the four capabilities: cited answers, who knows what, what-if departures, human-approved actions. Wrote the content of the standing brief, including its hard rules: FalkorDB is the only database the product reasons over, the answer key never reaches the graph or prompts, every value is a `$parameter`, and the code must be explainable line by line | Turned the brief into `AGENTS.md` / `CLAUDE.md` and kept it up to date |
| **Data** | Chose the public, synthetic OrgForge dataset (MIT). Decided to keep the 22 recovered alert, invoice and NPS rows; to keep only tags that describe what a document is and drop every tag that encodes simulator state; and to treat post-simulation dates as unknown | Wrote `scripts/prepare_orgforge.py` with its leakage scan and self-checks |
| **Graph model and Cypher** | Designed the spec queries K1 to K11 (`docs/spec-queries.md`), including the `KNOWS` weights (authored 3, reviewed 2, assigned 1) and the 30-day decay, and required the Cypher to be kept as written, with every change FalkorDB forced listed. Made the modelling calls when the data pushed back: `AUTHORED` only for real authorship, `PARTICIPATED {messages}` for multi-person threads and meetings, the `wrote` guard on activity, departures read from announcements in the documents and never from the answer key, and what-if on the small `apex_proj` copy instead of `apex`. Chose which of Claude's proposed system merges, aliases and thresholds to apply | Implemented the modules and queries, wrote fixture tests, ran the checks I asked for, and reported every Cypher change |
| **LLM use and cost** | Picked OpenAI with a Gemini fallback switch, ran a 200-artifact sample before the full extraction, picked `gpt-5-nano` after checking the cost, required every LLM output to be cached, and capped benchmark runs (I turned down a 600-call run) | Built `LlmService` (validation, retries, cache, key rotation) and the cost estimates |
| **Benchmark** | Specified B1 (departure prediction) and B2 (question answering against a vector-only baseline with the same model and context budget), and the answer-key isolation enforced by a lint rule. Questioned weak results and asked for root causes, asked for more questions so the statistics hold up (all 78), chose the judge model, and decided how results are published | Implemented the bench, the statistics (Wilson intervals, sign test, evidence recall) and the runs |
| **Agent, memory and live updates** | Asked for the agent as an MCP client of our own MCP server, a citation guardrail, human approval before any action counts, and, after reviewing the gaps against the track brief, agent memory in the graph and live document updates | Implemented the agent loop, MCP tools, guardrail, memory module, live-update pipeline and their tests |
| **Web app** | Gave the design direction and many rounds of review from screenshots: layout inspired by my own Intake app, removing "AI-generated" looks, the chat layout, history, message delete, Markdown viewer, panel widths, pagination, and the placement of the approve, reject and feedback controls. Supplied the logo | Built the Next.js app and made the white logo variant and favicon files |
| **Deployment** | Set up AWS myself (EC2 instance, Elastic IP, SSH keys, ports), copied the data, set up Vercel and the domain, and ran and debugged the production build (out-of-memory during the Docker build, a failing seed). Claude Code was told not to run any AWS command | Wrote the Dockerfiles, `docker-compose.prod.yml`, Caddy config, deploy script, `docs/deploy.md` and the GitHub Actions deploy job |
| **Git** | Reviewed the diff behind every commit, decided how to group commits, pushed, and merged PRs #1 to #12 | Proposed commit groupings and one-line messages |

---

## 3. Build log

All dates are October 2026. Each row is one stage brief I gave Claude Code, what it produced, and how the result was checked.

| Date | Stage | What Claude Code produced | My input and how it was checked |
| --- | --- | --- | --- |
| 15 | 0 Brief | `AGENTS.md` / `CLAUDE.md` standing brief | My spec and hard rules; kept private (gitignored) because it is a working brief |
| 15 | 1 Scaffold | pnpm monorepo, NestJS API, Next.js web, shared Zod schemas, Docker Compose, `pnpm capability-check` | I fixed the port layout (web on 3000, FalkorDB Browser on 3100); the capability check passes for every FalkorDB feature used |
| 15 | 2 Data | `prepare_orgforge.py`: artifact and answer-key split, recovered rows, day inference, calendar, tag allowlist, leakage scan | Three rounds of my fixes (recovered rows, tag allowlist, post-simulation dates); the script's self-checks pass |
| 15 | 3 Schema | Indexes, `batchWrite`, memory guard, mini-company fixture and integration harness | Fixture tests against a real FalkorDB |
| 15 | 4 Ingestion | Deterministic ingest (no LLM), BullMQ day-by-day replay, SSE progress, TextStore | I asked for a PASS/FAIL report: node and edge counts, every artifact exactly once, no bodies in the graph, days matching `stats.md` |
| 15 | 5 Extraction | LLM layer, extraction of systems and decisions, `SUPERSEDES` / `ASSERTS` second pass | I chose the provider and model, ran a sample first, approved aliases, and raised the decision confidence threshold from 0.6 to 0.7; checked that a rerun makes zero LLM calls |
| 15 | 6 Retrieval | Chunking, cached embeddings, vector index, hybrid and vector-only search | Memory estimate before writing; unit and integration tests |
| 16 | 7 Expertise | K2 to K10 as Cypher constants, `KNOWS`, `COLLAB`, `apex_proj`, analytics endpoints, system catalog | My spec queries; my decisions on merge groups, the participation model and the activity rule; a "done when" check that every query has a passing fixture test |
| 16 | 7 follow-up | Departures from announcements, targeted stale-page pass, cache-only rebuild order | I required that the answer key is never read; the cache-only rebuild matches `apex` exactly |
| 16 | 8 What-if | `GRAPH.COPY` scratch simulation on `apex_proj`, sweeper, concurrency limit | My refinement: copy `apex_proj`, not `apex` |
| 16–17 | 9 MCP | MCP server over Streamable HTTP and stdio | Tool list I specified; `pnpm mcp:check` |
| 17 | 10 Agent | Agent as an MCP client, question classifier, citation guardrail, SSE | My system prompt and rules |
| 17 | 11 Actions | Proposals as `Action` nodes, approve and reject, `WHY_SUGGESTED` audit | Approving moves the real `ASSIGNED` edge; integration tests |
| 17 | 12 Web app | Org Pulse, Ask, What-if, Decisions, Audit; then a full redesign | My design direction and screenshot reviews |
| 17 | 13 Benchmark | B1 and B2, answer-key guard (ESLint and Jest), statistics | My design and limits; I questioned weak results and asked for root causes and more questions |
| 17–18 | 14 Production | Backup and restore, offline `pnpm seed`, production Docker and Caddy, deploy guide, CI deploy | I did the AWS and Vercel setup and debugged the build and seed on the server |
| 18 | 15 Polish | Ask as a full chat with history, mentions, Markdown sheets, logo and favicon | Many rounds of my UI review |
| 18 | 16 Memory | Sessions, turns, feedback and approved notes in the graph; `recall_memory` | Chosen from my review of the gaps against the challenge brief; end-to-end run where a correction stays invisible until a person approves it |
| 18 | 17 Live and tools | Live documents, `how_connected` (`algo.SPpaths`), `central_people` (PageRank), per-tool Cypher, published bench results | My request to keep results in a tracked file so the server needs no data upload; reset returns the graph exactly to its earlier figures |
| 18 | Submission docs | This file and the README graph map | Written with Claude Code from my prompts and the git history; reviewed by me |
| 18 | 18 Win list | Risk watcher (proposals after every live change), `triage_incident` (T1–T3), evidence ranked by mention counts with a passage per citation, agent rate limit, stray "Yes." fix, MIT licence | My list of improvements for Tracks 01 and 03 (`WIN13.md`); checked end to end on the local graph (watcher, triage, citations) with unit and integration tests. Community detection was tried and dropped because it finds a single group on this data |

---

## 4. How the work was checked

- **73 test files** (Jest unit tests, plus integration tests against a real FalkorDB on a small fixture graph). Every Cypher query lives in a `queries/` file as a named constant with a comment.
- **`pnpm capability-check`** passes for every FalkorDB feature Keystone relies on.
- **`LLM_CACHE_ONLY=yes`** turns any cache miss into an error, which shows that a rebuild makes no LLM calls.
- **The answer key cannot leak:** an ESLint rule and a repo-wide Jest test fail if any code outside `apps/api/src/bench/` names `data/answer_key/`.
- **The benchmark** compares Keystone against a vector-only baseline using the same model and context budget, with a blinded judge. It is honest about its limits: the agent's prompts were improved between runs while looking at these questions, and B1 is shown as worked examples (n = 2), not as a score.
- **The live deployment** was checked against the API (`/health`, `/analytics/summary`, `/queries`) after each deploy.

I can explain the graph model, every query, the architecture and the trade-offs; see the README for each of them.
