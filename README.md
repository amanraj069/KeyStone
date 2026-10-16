# Keystone

A Company Brain agent built on [FalkorDB](https://www.falkordb.com) for the
Graph Hacks hackathon (WeMakeDevs x FalkorDB, Oct 15–18, 2026).

Keystone builds a knowledge graph of the synthetic OrgForge "Apex Athletics"
company, answers questions with cited sources, works out who knows what,
simulates "what if this person leaves", and proposes actions a human approves.

How the graph is built: `data/artifacts.jsonl` is ingested without any LLM
(people, artifacts, who authored, reviewed or owns what); an LLM extracts the
systems and decisions each artifact talks about (cached, so a rebuild needs no
LLM calls); chunks are embedded for search; then FalkorDB computes who knows
each system (`KNOWS`), who works with whom (`COLLAB`) and the analytics on top.

- **Who did what.** `AUTHORED` is real authorship: a page, PR, email, the creator of a
  ticket, or the single writer of a Slack thread. People in a multi-person thread or a
  meeting get `PARTICIPATED {messages}` (one message = one `Name:` line), `REVIEWED` is a
  PR review and `ASSIGNED` is ticket ownership.
- **Departures** come from HR announcements found in the company's own documents ("X's last
  day is ...", "X is leaving the company"): they set `departedDay`, keep the announcing artifact
  as evidence, and make the person inactive from that day on (their past work stays in the graph).
- **Expertise (`KNOWS`).** Each person-system pair is scored from the artifacts that
  mention the system: authored 3, reviewed 2, assigned 1, participated
  0.5 x min(messages, 4) / 4, each with a 30-day exponential decay.
- **Core systems.** A system is core when at least 5 artifacts mention it, written by at
  least 2 people (144 of 1,939). Bus factor, departure impact and the projection use core
  systems only.
- **Experts.** A person is an expert on a core system when their score is at least
  `MIN_EXPERT_SCORE` = 0.4 and at least 25% of that system's top score. 0.4 is the median
  KNOWS score on core systems (0.41), rounded; the rule was fixed before looking at the
  results and without the benchmark answers.

The queries are documented in [docs/spec-queries.md](docs/spec-queries.md).

## Layout

| Path | What it is |
| --- | --- |
| `apps/api` | NestJS 11 API (port 4000). The only thing that talks to FalkorDB. |
| `apps/web` | Next.js 15 web app (port 3000). |
| `packages/shared` | Zod schemas and types shared by both apps. |
| `scripts/` | Python data prep. |
| `docker-compose.yml` | Local FalkorDB (6379 + Browser on 3100) and Redis for BullMQ (6380). |
| `docker-compose.prod.yml` | Production stack. |

## Quick start

```bash
cp .env.example .env          # then set FALKOR_PASSWORD
docker compose up -d          # FalkorDB + Redis
pnpm install
pnpm dev                      # API on :4000, web on :3000
```

Open http://localhost:3000 for the status page, http://localhost:3100 for the
FalkorDB Browser.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Builds shared, then runs shared (watch), API and web in parallel |
| `pnpm build` | Builds every package |
| `pnpm test` | Unit tests (no Docker needed) |
| `pnpm --filter @keystone/api test:int` | Integration tests against the running FalkorDB |
| `pnpm lint` | ESLint everywhere |
| `pnpm capability-check` | PASS/FAIL for every FalkorDB feature Keystone needs |
| `pnpm extract [--dry-run]` | Extract systems and decisions with the LLM (cached) |
| `pnpm embed [--dry-run]` | Build the retrieval chunks and embeddings (cached) |
| `pnpm reingest-roles` | Rewrite person-artifact role edges from `artifacts.jsonl` (no reset), then refresh expertise |
| `pnpm systems report` | System catalog: distribution by mentions and authors, top 50, core counts |
| `pnpm expertise [--as-of N]` | Recompute KNOWS + COLLAB on apex, rebuild `apex_proj`, print the KNOWS score distribution |
| `pnpm llm-check` | One cached JSON call + one embedding with the configured LLM provider |
| `scripts/.venv/bin/python scripts/prepare_orgforge.py` | Download OrgForge and write `data/artifacts.jsonl` (see `scripts/README.md`) |

## Rebuilding the graph

Everything in the graph is rebuilt from `data/artifacts.jsonl` and the caches in `DATA_DIR`
(extraction, LLM answers, embeddings), so a rebuild makes no LLM calls. Order:

1. `POST /ingest/full` - people, artifacts and role edges (no LLM)
2. `pnpm reingest-roles` - only when upgrading an existing graph to new role rules (a fresh ingest already writes them)
3. `pnpm extract` - systems, decisions, SUPERSEDES/ASSERTS (cached)
4. `pnpm expertise` - system statistics and core flags, KNOWS, COLLAB, `apex_proj`
5. `pnpm extract --relink-stale` - targeted stale-page pass on core systems (cached; needs the core flags from step 4)
6. `pnpm embed` - chunks and embeddings (cached)
7. `pnpm expertise` - final refresh of KNOWS, COLLAB and `apex_proj`

`LLM_CACHE_ONLY=yes` turns any cache miss into an error, which proves a run made no calls.
TODO: wrap these steps in a single `pnpm seed` command.

## LLM provider

All LLM use goes through `LlmService` (`apps/api/src/llm/`): OpenAI when
`USE_OPENAI=yes` (key `OPENAI_API_KEY`, default models `gpt-5-nano` and
`text-embedding-3-small`), otherwise Gemini (`GEMINI_API_KEYS`, comma separated).
Every answer is validated with Zod and cached in `DATA_DIR/llm-cache`, so a
repeated request costs no LLM call; `LLM_CACHE_ONLY=yes` makes a cache miss an
error. Embeddings are shortened to `EMBED_DIM` (768) on both providers. Check the
setup with `pnpm llm-check` after adding a key.

## Extraction

LLM extraction of **System** and **Decision** nodes from artifact text
(`apps/api/src/extract/`). It reads bodies from the TextStore (never the graph),
selects Pages, Threads, PRs, Emails and Meetings with a body over 300
characters, plus every Ticket (a sprint ticket's title names the systems it
touches), seeds a system-name vocabulary from artifact text plus the
hand-editable `apps/api/src/extract/aliases.json`, then:

1. per artifact: systems (MENTIONS {weight}), decisions (DECIDED_IN, ABOUT) and page claims;
2. per system with 2+ decisions/claims: SUPERSEDES between decisions and ASSERTS from pages.

Every answer is Zod-validated and cached (`DATA_DIR/cache/extract/<doc_id>.json` and
`DATA_DIR/llm-cache`), so a rerun costs zero LLM calls; prove it with
`LLM_CACHE_ONLY=yes pnpm extract`. Results: `data/stats-extraction.md`.

| Command / endpoint | What it does |
| --- | --- |
| `pnpm extract --dry-run` | Plan and cost estimate; no LLM calls, no writes |
| `pnpm extract --limit 50` | Trial on 50 artifacts spread across types |
| `pnpm extract [--force] [--refresh]` | Full run (stops above `EXTRACT_MAX_CALLS` unless `--force`) |
| `pnpm extract --relink-stale [--claims-only] [--dry-run]` | Targeted second pass for stale pages on core systems (run after `pnpm extract`; cached) |
| `POST /extract/run` `{"dryRun":false,"force":false}` | Same, as a BullMQ job; follow `GET /extract/jobs/:id/events` |

### System catalog

Extraction names many systems once or twice. The catalog (`apps/api/src/catalog/`)
writes `mentionCount`, `authorCount`, `core` and `idf` onto every System (refreshed
with expertise). A system is **core** when at least `CORE_MIN_MENTIONS` (5) artifacts
mention it, written by at least 2 people; bus factor, departure impact and `apex_proj`
use core systems only, while every system stays in `apex` for search and citations.
`idf = log(totalArtifacts / (1 + mentionCount))` makes niche systems count more when
suggesting ticket owners.

| Command | What it does |
| --- | --- |
| `pnpm systems merge [--dry-run]` | Merge names that differ only by case, punctuation, version or a generic last word ("service", "system", "api"); records them in `aliases.json` |
| `pnpm systems propose` | One cached LLM call proposing merge groups for the 300 most mentioned systems (saved for review, not applied) |
| `pnpm systems apply-proposals` | Apply the reviewed proposals |

## Retrieval

`pnpm embed` splits every artifact body (from the TextStore) into chunks of about
800 characters with 100 characters of overlap (title first, at most 6 per
artifact; fewer if memory would pass `MEMORY_WARN_MB`), stores the chunk text in
the TextStore, embeds it (cached, `EMBED_DIM` 768) and writes
`(:Chunk {id, artifactId, model, embedding})-[:PART_OF]->(:Artifact)`. No text in the graph.
`pnpm embed --dry-run` prints chunk counts, the memory estimate and cost without calling anything.

| Endpoint | What it does |
| --- | --- |
| `GET /search?q=&k=[&asOfDay=]` | Hybrid: nearest chunks from the vector index, plus each artifact's REFERENCES neighbours (2 hops) and authors from the graph |
| `GET /search/vector-only?q=&k=` | Baseline for benchmarks: the same vectors and k, no graph expansion |

FalkorDB's vector `score` is a cosine **distance** (0 = identical), so results are
ordered ascending; responses also carry `similarity = 1 - distance`.

## Expertise and analytics

`POST /analytics/refresh-expertise {graph?, asOfDay?}` (admin token) runs a BullMQ job: K2 materialises
`KNOWS` (recency-weighted, 30-day decay, computed in Cypher), edges below 0.05 are deleted,
K8a rebuilds `COLLAB`, then the graph's projection is rebuilt (`apex` -> `apex_proj`,
`apex_replay` -> `apex_proj_replay`): Person, core System, KNOWS, and COLLAB pairs at or above the
median weight, in both directions (~1 MB vs 47 MB for apex). Progress: `GET /analytics/jobs/:id/events`.
`pnpm expertise` does the same for apex from the command line.

A replay (`POST /ingest/replay`) runs the same steps after every replayed day: it copies that
day's extraction (systems, mentions, decisions, SUPERSEDES, ASSERTS) from apex without LLM
calls, then refreshes expertise as of that day.

| Endpoint | Query | Graph |
| --- | --- | --- |
| `GET /systems/:name/experts` | K3a experts + K3b evidence graph `{nodes, edges}` of the top one | apex |
| `GET /systems/:name/decisions` | K10a decision trace (what replaced what, source, authors) | apex |
| `GET /people/:name/departure-impact?minScore=` | K5 systems + backups, K6 open tickets + suggested owners (with evidence), K7 unshared pages | apex |
| `GET /analytics/bus-factor?minScore=` | K4 with `riskLevel` (0 orphaned, 1 critical, 2 watch, 3+ ok) | apex_proj |
| `GET /analytics/bridges` | K8b betweenness on COLLAB, top 10, with cross-department evidence | apex_proj |
| `GET /analytics/stale-docs` | K10b pages asserting a superseded decision | apex |
| `GET /analytics/summary?minScore=` | People, systems by risk level, stale docs, open tickets, memory | both |

Every response that states a fact carries the artifact ids it came from. Default
`minScore` overrides the expert floor (default `MIN_EXPERT_SCORE` 0.4, see "How the graph is built").
FalkorDB returns at most `RESULTSET_SIZE` rows (10,000 by default); `GraphService` throws
when a result reaches it, and the projection reads page with `SKIP/LIMIT`.

## Ingestion

Deterministic, no LLM: `data/artifacts.jsonl` -> FalkorDB through a BullMQ queue
on the separate Redis. In dev the API runs the worker itself
(`INGEST_WORKER_INLINE=true`); in production the `worker` container runs
`node dist/worker.js`.

| Endpoint | What it does |
| --- | --- |
| `POST /ingest/full` `{"graph":"apex"}` | Rebuild `apex` from scratch with every artifact |
| `POST /ingest/replay` `{"fromDay":1,"toDay":5,"delayMs":2000}` | Rebuild `apex_replay` one day at a time |
| `GET /ingest/jobs/:id` | Job state and latest progress |
| `GET /ingest/jobs/:id/events` | Server-Sent Events: live progress until completed/failed |

The web page `/ingest` drives both and shows the stream. If `ADMIN_TOKEN` is
set, the POST endpoints need the header `x-admin-token`.

## Cypher queries

Every query lives in a `queries/` file as an exported constant.

| File | Constant | Returns |
| --- | --- | --- |
| `apps/api/src/graph/queries/graph.queries.ts` | `HEALTH_PING` | `{ ok: 1 }`, used by `GET /health` |
| `apps/api/src/graph/queries/schema.queries.ts` | `PERSON_NAME_INDEX`, `ARTIFACT_ID_INDEX`, `ARTIFACT_DAY_INDEX`, `SYSTEM_NAME_INDEX`, `DECISION_ID_INDEX`, `ACTION_ID_INDEX`, `CHUNK_EMBEDDING_VECTOR_INDEX` (via `chunkEmbeddingVectorIndex(EMBED_DIM)`), `LIST_INDEXES` | Index DDL run by `SchemaService.ensureSchema`; `LIST_INDEXES` returns label, properties, index types |
| `apps/api/src/ingest/queries/ingest.queries.ts` | `MERGE_DEPTS`, `MERGE_PEOPLE`, `MERGE_{TICKET,PAGE,THREAD,PR,EMAIL,MEETING,ALERT,RECORD}_ARTIFACTS`, `MERGE_AUTHORED`, `MERGE_REVIEWED`, `MERGE_PARTICIPATED`, `DELETE_ROLE_EDGES`, `MERGE_DEPARTURES`, `DELETE_DEPARTURE_EDGES`, `CLEAR_DEPARTED_DAYS`, `MERGE_ASSIGNED`, `MERGE_REFERENCES`, `MERGE_FIXES`, `UPDATE_PERSON_ACTIVITY`, `GRAPH_COUNTS` | Deterministic ingestion (all MERGE, safe to rerun); `GRAPH_COUNTS` returns people/artifacts/edges for the progress stream |
| `apps/api/src/extract/queries/extract.queries.ts` | `SELECT_CANDIDATES`, `ALL_ARTIFACT_IDS`, `PAGE_TITLES`, `CLEAR_EXTRACTION`, `MERGE_SYSTEMS`, `MERGE_MENTIONS`, `MERGE_DECISIONS`, `MERGE_ABOUT`, `MERGE_CLAIMS`, `SYSTEMS_FOR_LINKING`, `MERGE_SUPERSEDES`, `MERGE_ASSERTS`, `DELETE_CLAIMS`, `TOP_SYSTEMS_BY_MENTIONS`, `EXTRACTION_COUNTS`, `DECISIONS_BY_KIND`, `DECISIONS_WITHOUT_SYSTEM`, `STALE_PAGES`, `REPLAY_{SYSTEMS,MENTIONS,DECISIONS,ABOUT,SUPERSEDES,ASSERTS}_FOR_DAY`, `STALE_LINK_TARGETS`, `STALE_LINK_INPUT`, `DELETE_SAME_SOURCE_SUPERSEDES`, `REACTIVATE_UNSUPERSEDED` | LLM extraction: candidate selection, idempotent MERGE writes keyed by stable ids, second-pass input, report figures; replay copies one day's extraction from apex |
| `apps/api/src/catalog/queries/catalog.queries.ts` | `SET_SYSTEM_STATS`, `MARK_CORE_SYSTEMS`, `SET_SYSTEM_IDF`, `CORE_COUNT_AT`, `MENTION_BUCKETS`, `AUTHOR_BUCKETS`, `TOP_SYSTEMS`, `ALL_SYSTEM_COUNTS`, `SYSTEM_TOTALS`, `MERGE_SYSTEM_ALIASES`, `MOVE_SYSTEM_MENTIONS`, `MOVE_SYSTEM_ABOUT`, `DELETE_MERGED_SYSTEMS` | System statistics, core flag, idf, distributions, and merging duplicate systems |
| `apps/api/src/retrieval/queries/retrieval.queries.ts` | `DELETE_CHUNKS`, `CREATE_CHUNKS`, `ARTIFACTS_TO_CHUNK`, `CHUNK_VECTOR_INDEX`, `CHUNK_MODELS`, `HYBRID_SEARCH`, `VECTOR_ONLY_SEARCH` | Chunk writes (ids + embeddings only), vector-index check, hybrid search (vector + REFERENCES + authors) and the vector-only baseline |
| `apps/api/src/analytics/queries/analytics.queries.ts` | `SET_ACTIVE_AS_OF`, `K2_MATERIALISE_KNOWS`, `DELETE_ALL_KNOWS`, `DELETE_WEAK_KNOWS`, `DELETE_COLLAB`, `K8A_MATERIALISE_COLLAB`, `LAST_ARTIFACT_DAY`, `KNOWS_SCORE_DISTRIBUTION`, `EXPERTISE_COUNTS`, `K3A_SYSTEM_EXPERTS`, `K3B_EVIDENCE_PATH`, `SYSTEM_EXISTS`, `PERSON_EXISTS`, `K4_BUS_FACTOR`, `RISK_LEVEL_COUNTS`, `K5_DEPARTURE_SYSTEMS`, `K6_DEPARTURE_TICKETS`, `K7_DEPARTURE_PAGES`, `K8B_BRIDGES`, `BRIDGE_EVIDENCE`, `K10A_DECISION_TRACE`, `K10B_STALE_DOCS`, `PEOPLE_COUNTS`, `STALE_DOCS_COUNT`, `OPEN_TICKETS_COUNT` | Expertise (KNOWS, COLLAB), bus factor, departure impact, bridges, decision trace, stale docs, and the summary counts |
| `apps/api/src/projection/queries/projection.queries.ts` | `ACTIVE_PEOPLE`, `ACTIVE_PEOPLE_AS_OF`, `CORE_SYSTEMS`, `ACTIVE_KNOWS`, `KNOWS_AS_OF`, `ACTIVE_COLLAB_WEIGHT_PERCENTILE`, `ACTIVE_COLLAB`, `COLLAB_AS_OF_WEIGHT_PERCENTILE`, `COLLAB_AS_OF`, `WRITE_PEOPLE`, `WRITE_SYSTEMS`, `WRITE_KNOWS`, `WRITE_COLLAB`, `PROJECTION_COUNTS` | Paged reads from apex (current or as of a day) and writes into `apex_proj` |
| `apps/api/test/queries/test.queries.ts` | `COUNT_NODES_BY_LABEL`, `ARTIFACTS_AS_OF_DAY`, `WRITE_BATCH_PROBES`, `COUNT_BATCH_PROBES`, `ADA_NODE`, `ADA_AUTHORED_T1`, `SUPERSEDES_PATH`, `ACTIVE_EXPERTS_BY_SYSTEM`, `CROSS_DEPT_COLLABORATORS`, `PEOPLE_TO_TICKETS_PAGES_THREADS`, `ARTIFACT_LINKS`, `PEOPLE_SUMMARY`, `RETRIEVAL_FIXTURE`, `CHUNK_SUMMARY`, `GIVE_D1_A_SOURCE`, `EXTRACTION_SUMMARY`, `ALL_KNOWS`, `PROJECTION_COLLAB_PAIRS`, `SYSTEM_STATS`, `ADD_TITAN_DUPLICATE`, `TITAN_EDGES`, `IDF_FIXTURE`, `MARK_ALL_SYSTEMS_CORE`, `EVE_JOINS_MEETING`, `KNOWS_SCORE`, `COLLAB_WEIGHT`, `WORKLOAD_FIXTURE`, `BO_ON_DAY_9_THREAD`, `BO_ACTIVITY`, `DEPARTURES` | Integration tests only, against `test/fixtures/mini-company.cypher` |
| `apps/api/scripts/queries/capability-check.queries.ts` | `CREATE_PEOPLE`, `CREATE_KNOWS_EDGES`, `COUNT_NODES_AND_EDGES`, `BETWEENNESS`, `WCC`, `PAGE_RANK`, `EXP_ONE`, `CREATE_VECTOR_INDEX`, `SET_EMBEDDINGS`, `VECTOR_NEAREST`, `COUNT_PEOPLE` | Capability check only |

## AI usage

AI tools were used to build Keystone, as the hackathon rules require us to disclose:

- **Claude Code (Claude Opus 5.5)** wrote most of the code, tests and documentation
  from our written specs; every change was reviewed, run and tested
  before it was committed.
- **OpenAI `gpt-5-nano`** runs inside the product: it extracts systems and decisions from
  artifact text and links decisions to the pages that state them (cached, Zod-validated).
- **OpenAI `text-embedding-3-small`** embeds artifact chunks for search.
- **create-next-app** and the **shadcn/ui** CLI generated the web app template and UI components.

