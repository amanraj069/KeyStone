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
| `apps/web` | Next.js 15 web app (port 3001). |
| `packages/shared` | Zod schemas and types shared by both apps. |
| `scripts/` | Python data prep. |
| `docker-compose.yml` | Local FalkorDB (6379 + Browser on 3000) and Redis for BullMQ (6380). |
| `docker-compose.prod.yml` | Production stack (completed in Stage 14). |

## Quick start

```bash
cp .env.example .env          # then set FALKOR_PASSWORD
docker compose up -d          # FalkorDB + Redis
pnpm install
pnpm dev                      # API on :4000, web on :3001
```

Open http://localhost:3001 for the status page, http://localhost:3000 for the
FalkorDB Browser.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Builds shared, then runs shared (watch), API and web in parallel |
| `pnpm build` | Builds every package |
| `pnpm test` | Unit tests (no Docker needed) |
| `pnpm --filter @keystone/api test:int` | Integration tests against the running FalkorDB |
| `pnpm lint` | ESLint everywhere |
| `pnpm capability-check` | PASS/FAIL for every FalkorDB feature Keystone needs |

## Cypher queries

Every query lives in a `queries/` file as an exported constant.

| File | Constant | Returns |
| --- | --- | --- |
| `apps/api/src/graph/queries/graph.queries.ts` | `HEALTH_PING` | `{ ok: 1 }`, used by `GET /health` |
| `apps/api/scripts/queries/capability-check.queries.ts` | `CREATE_PEOPLE`, `CREATE_KNOWS_EDGES`, `COUNT_NODES_AND_EDGES`, `BETWEENNESS`, `WCC`, `PAGE_RANK`, `EXP_ONE`, `CREATE_VECTOR_INDEX`, `SET_EMBEDDINGS`, `VECTOR_NEAREST`, `COUNT_PEOPLE` | Capability check only |

## AI usage

See [AI_USAGE.md](AI_USAGE.md).
