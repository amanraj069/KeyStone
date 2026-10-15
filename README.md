# Keystone

A Company Brain agent built on [FalkorDB](https://www.falkordb.com) for the
Graph Hacks hackathon (WeMakeDevs x FalkorDB, Oct 15–18, 2026).

Keystone builds a knowledge graph of the synthetic OrgForge "Apex Athletics"
company, answers questions with cited sources, works out who knows what,
simulates "what if this person leaves", and proposes actions a human approves.

> Work in progress. Stage 1: monorepo scaffold, FalkorDB connection, health check.

## Layout

| Path | What it is |
| --- | --- |
| `apps/api` | NestJS 11 API (port 4000). The only thing that talks to FalkorDB. |
| `apps/web` | Next.js 15 web app (port 3000). |
| `packages/shared` | Zod schemas and types shared by both apps. |
| `scripts/` | Python data prep. |
| `docker-compose.yml` | Local FalkorDB (6379 + Browser on 3100) and Redis for BullMQ (6380). |
| `docker-compose.prod.yml` | Production stack (completed in Stage 14). |

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
| `scripts/.venv/bin/python scripts/prepare_orgforge.py` | Download OrgForge and write `data/artifacts.jsonl` (see `scripts/README.md`) |

## Ingestion (Stage 4)

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
| `apps/api/src/ingest/queries/ingest.queries.ts` | `MERGE_DEPTS`, `MERGE_PEOPLE`, `MERGE_{TICKET,PAGE,THREAD,PR,EMAIL,MEETING,ALERT,RECORD}_ARTIFACTS`, `MERGE_AUTHORED`, `MERGE_REVIEWED`, `MERGE_ASSIGNED`, `MERGE_REFERENCES`, `MERGE_FIXES`, `UPDATE_PERSON_ACTIVITY`, `GRAPH_COUNTS` | Deterministic ingestion (all MERGE, safe to rerun); `GRAPH_COUNTS` returns people/artifacts/edges for the progress stream |
| `apps/api/test/queries/test.queries.ts` | `COUNT_NODES_BY_LABEL`, `ARTIFACTS_AS_OF_DAY`, `WRITE_BATCH_PROBES`, `COUNT_BATCH_PROBES`, `ADA_NODE`, `ADA_AUTHORED_T1`, `SUPERSEDES_PATH`, `ACTIVE_EXPERTS_BY_SYSTEM`, `CROSS_DEPT_COLLABORATORS`, `PEOPLE_TO_TICKETS_PAGES_THREADS`, `ARTIFACT_LINKS`, `PEOPLE_SUMMARY` | Integration tests only, against `test/fixtures/mini-company.cypher` |
| `apps/api/scripts/queries/capability-check.queries.ts` | `CREATE_PEOPLE`, `CREATE_KNOWS_EDGES`, `COUNT_NODES_AND_EDGES`, `BETWEENNESS`, `WCC`, `PAGE_RANK`, `EXP_ONE`, `CREATE_VECTOR_INDEX`, `SET_EMBEDDINGS`, `VECTOR_NEAREST`, `COUNT_PEOPLE` | Capability check only |

## AI usage

See [AI_USAGE.md](AI_USAGE.md).
