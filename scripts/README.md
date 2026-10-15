# scripts/

Python data-prep scripts. They run once, offline, and produce the files the
seed command loads. No LLM calls here unless the result is cached to a file.

## Setup

```bash
python3.12 -m venv scripts/.venv
scripts/.venv/bin/pip install -r scripts/requirements.txt
```

## `prepare_orgforge.py`

```bash
scripts/.venv/bin/python scripts/prepare_orgforge.py
```

Lists the public Hugging Face dataset `aeriesec/orgforge`, downloads the corpus
parquet and the evaluation questions, parses the JSON-as-text columns
(`actors`, `tags`, `artifact_ids`, `facts`), splits every row into exactly one
of two places, and ends with a self-check that exits non-zero if a safety rule
is broken.

| File | What it is | Who may read it |
| --- | --- | --- |
| `data/artifacts.jsonl` | Real company documents: rows with `category == "artifact"` plus the doc types in `RECOVERED_ARTIFACT_DOC_TYPES`. One JSON object per line, sorted by time, de-duplicated on `doc_id`, ground-truth `facts` keys stripped. Rows whose day was inferred come last. | The seed command. **The only file that may reach FalkorDB.** |
| `data/calendar.json` | Every simulation day (1–60) with its date and weekday, built from artifact rows only. | Anyone. The only way to convert days to dates. |
| `data/stats.md` | Row counts, artifact doc types, day range, actors, departments, inferred days, stripped keys. | Anyone. |
| `data/answer_key/sim_events.jsonl` | Every non-artifact row: `sim_event`, `sim_config`, and uncategorised simulator output (Datadog metric ticks, department plans, planner reasoning). | Benchmark code only. |
| `data/answer_key/questions.jsonl` | The 78 evaluation questions with ground truth and evidence chains, byte for byte as published. | Benchmark code only. |
| `data/answer_key/departures.json` | The 4 people who left: `name`, `role`, `day`, `documentedPct`, `domains`, `before_day_1`. | Benchmark code only. |
| `data/answer_key/gap_events.jsonl` | All 2,439 `employee_departed` and `knowledge_gap_detected` events, with extracted fields plus the full `facts`. | Benchmark code only. |
| `data/answer_key/raw/` | Untouched downloads. The parquet mixes artifacts with answer-key rows, so it lives here too. | Nobody but this script. |

### Why `answer_key/` must never be loaded into FalkorDB

The simulator's event log records the *truth* behind the documents: who really
owned a domain, which knowledge gap a postmortem exposed, when someone left and
how much they had documented. The evaluation questions are scored against
exactly those facts.

If any of it reached the graph, the agent, a prompt or an embedding, Keystone
would be reading the answers instead of deriving them from documents, and
every benchmark score would be meaningless. So:

- the seed command reads `data/artifacts.jsonl` (and `data/calendar.json`) and
  nothing under `answer_key/`;
- benchmark code may read `answer_key/` only to **score** results, after the
  agent has answered;
- names from the answer key (departure domains such as `auth-service`) are
  never copied into aliases, prompts or code; vocabularies come from artifacts.

### What goes into `artifacts.jsonl`

**Recovered artifacts.** `RECOVERED_ARTIFACT_DOC_TYPES` in `prepare_orgforge.py`
is the single source of truth. 6,622 rows have no category at all; the OrgForge
README's schema defines `datadog_alert`, `invoice` and `nps_survey` as artifact
types, so those 22 rows are kept (with `source_category: null`). The other
uncategorised types (`datadog_metric`, `dept_plan`, `dept_plan_reasoning`) are
simulation events and go to the answer key, as does the single `sim_config` row.

**Leakage scan.** Some artifact `facts` carry the simulator's own labels, for
example a PR's `gap_classification` or `author_domain_fit`, or an incident's
`recurrence_of`. These describe what the simulator knows, not what a reader of
the document sees, so every key in `STRIPPED_FACTS_KEYS` is removed. Document
content stays: `causal_chain`, `sprint_number`, `status`, `title`, `root_cause`
(always present in the document text), sender and recipient fields, and so on.
The script prints every facts key with its count and verdict; `stats.md` lists
what was stripped.

**Inferred days.** 17 artifacts (12 Datadog alerts, 5 sprint retros) have no
timestamp and a placeholder `day: 0`. Their day is re-derived **only from other
artifacts**:

1. Links: an artifact it links to, or that links to it, via `artifact_ids` or
   `facts.causal_chain`. The earliest linked day wins (an alert fires before or
   when its ticket opens).
2. Sprint: a sprint number in the title or `facts` is matched to `jira` rows
   with the same `facts.sprint_number`; the sprint's last ticket day is used.
3. Otherwise `day: null` and `dayUnknown: true`.

Inferred rows carry `dayInferred: true` and `inferredFrom` (a `doc_id` or the
sprint rule) and are written at the end of the file.

**Timestamps.** The corpus mixes ISO strings with and without an offset, epoch
seconds, and the odd Unicode hyphen; `timestamp_utc` normalises them all.

### Calendar

Simulation days are business days: day 1 is Thursday 2026-01-01, day 3 is
Monday 2026-01-05, day 60 is Wednesday 2026-03-25. For each day the most common
`date` among its artifacts wins. Day 0 is left out: it is a catch-all bucket
whose rows carry dates from across the whole period. Always convert through
`data/calendar.json`, never by adding days to a start date.
