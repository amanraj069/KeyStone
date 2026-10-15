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
| `data/artifacts.jsonl` | Real company documents: rows with `category == "artifact"` plus the doc types in `RECOVERED_ARTIFACT_DOC_TYPES`. One JSON object per line, sorted by (day, timestamp), de-duplicated on `doc_id`, ground-truth `facts` keys stripped, tags filtered through `KEPT_TAGS`, day-0 rows remapped through the calendar. | The seed command. **The only file that may reach FalkorDB.** |
| `data/calendar.json` | Every simulation day (1–60) with its date and weekday, built from artifact rows only. | Anyone. The only way to convert days to dates. |
| `data/stats.md` | Row counts, artifact doc types, artifacts per day, `dayInferred` counts, tag keep/drop table, stripped facts keys, actors, departments. | Anyone. |
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

**Simulator text scrubbed.** Some document text carried answer-key labels:
incident titles and bodies ended with annotations such as
`[TitanDB, legacy auth service undocumented]` (a knowledge-gap label) and
`[recurrence of ENG-112]` (a recurrence label). `SIMULATOR_ANNOTATION` cuts them
out of every title and body. Three rows (`PR-101`, `PR-111`, `PR-117`) were not
documents at all, just a `gap_areas: ...` record naming departure domains;
`SIMULATOR_RECORD_BODY` moves them to the answer key. A self-check fails if any
annotation or record body remains.

**Tags allowlist.** Tags pass through `KEPT_TAGS` (built from `TAG_DECISIONS`,
each tag with a one-line reason). A tag survives only if it says what a
document is or where it came from: channel or doc type (`slack`, `jira`),
direction (`inbound`), department (`hr_ops`), sender (`nora`) or work type
(`sprint_backlog`). Tags that encode simulator state, lifecycle or outcomes
(`causal_chain`, `knowledge_gap`, `reviewer_audit`, `recurrence`,
`departed_employee`, `async_question`, `escalation`, ...) are dropped, and any
tag not listed is dropped by default. The script prints the full keep/drop
table before writing; `stats.md` keeps a copy.

**Days remapped through the calendar.** The `date` column is the source of
truth for `day`; timestamps (and Slack doc_ids) can run 1-12 days later and
only order rows within a day. The dataset puts most Slack and Confluence rows at
`day: 0`, and the recovered invoices and NPS surveys on a placeholder day 30,
even though they carry real dates. So:

| Case | Result |
| --- | --- |
| date after the last simulated date (the dataset's generation date) | treated as no date: kept as `rawDate`, `date` cleared, row goes through the inference below |
| day 0 or recovered row, date is a simulated business day | `day` = that day, `dayInferred: "calendar"`, `originalDay` = old day |
| day 0 or recovered row, date before the first simulated date | stays day 0, `dayInferred: "pre-sim"` |
| day 0 or recovered row, date on a weekend | previous business day, `dayInferred: "calendar-nearest"` |
| genuine day >= 1 | checked against the calendar; any mismatch fails the self-check |

**Rows with no usable date.** 19 artifacts: 12 Datadog alerts and 5 sprint
retros with neither date nor timestamp, plus 2 rows whose only date was
post-simulation (`CONF-RETRO-001`, `NPS-85B237FD`). Their day is re-derived
**only from other artifacts' corrected days**:

1. `link`: an artifact it links to, or that links to it, via `artifact_ids` or
   `facts.causal_chain`; the earliest linked day wins (an alert fires before or
   when its ticket opens).
2. `sprint`: a sprint number in the title or `facts` is matched to `jira` rows
   with the same `facts.sprint_number`; the sprint's last ticket day is used.
3. Otherwise `day: null` and `dayUnknown: true`.

These rows carry `dayInferred` (`"link"` or `"sprint"`), `inferredFrom` (a
`doc_id` or the sprint rule) and `originalDay`.

**Order.** `artifacts.jsonl` is sorted by (day, timestamp, doc_id); rows without
a timestamp come last within their day, and `dayUnknown` rows come last overall.

**Timestamps.** The corpus mixes ISO strings with and without an offset, epoch
seconds, and the odd Unicode hyphen; `timestamp_utc` normalises them all.

### Calendar

`data/calendar.json` is built only from trustworthy rows: artifacts with a
genuine day >= 1 and a date (recovered rows are excluded, their days are placeholders). For each day the majority date wins (conflicts are
printed). Missing days would be filled by business-day arithmetic, and every
day that has data must agree with that arithmetic or the script stops. It
records `firstDay`/`firstDate` and `lastDay`/`lastDate`.

Day 1 is Thursday 2026-01-01 and day 60 is Wednesday 2026-03-25. Weekends are
skipped and there are no holidays. Always convert through `data/calendar.json`,
never by adding days to a start date.

### Self-check

The script ends by re-reading what it wrote and fails loudly unless:

- no tag outside `KEPT_TAGS` appears in `artifacts.jsonl`;
- no artifact has day 0 unless it pre-dates the simulation;
- every artifact with a date has a day consistent with `calendar.json`
  (expected disagreements: 0);
- no `doc_id` is in both `artifacts.jsonl` and `answer_key/*.jsonl`;
- no `STRIPPED_FACTS_KEYS` key remains in artifact `facts`;
- every artifact has an integer day or `dayUnknown: true`.
