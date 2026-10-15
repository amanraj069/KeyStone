"""Download the OrgForge "Apex Athletics" dataset and split it into safe files.

Usage (from the repo root):
    python3.12 -m venv scripts/.venv
    scripts/.venv/bin/pip install -r scripts/requirements.txt
    scripts/.venv/bin/python scripts/prepare_orgforge.py

Outputs (see scripts/README.md):
    data/artifacts.jsonl                 the ONLY file the product may load
    data/calendar.json                   simulation day -> date and weekday
    data/stats.md                        human-readable summary
    data/answer_key/sim_events.jsonl     benchmark answer key, never loaded
    data/answer_key/questions.jsonl      evaluation questions, never loaded
    data/answer_key/departures.json      the people who left, for benchmarking
    data/answer_key/gap_events.jsonl     departure / knowledge-gap events
    data/answer_key/raw/                 the untouched downloads (mixed data)

Hard rule (AGENTS.md section 2): only rows written to data/artifacts.jsonl may
reach FalkorDB. Everything else is answer-key data and goes under data/answer_key/.
"""

from __future__ import annotations

import json
import re
import shutil
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from huggingface_hub import HfApi, hf_hub_download

REPO_ID = "aeriesec/orgforge"
REPO_TYPE = "dataset"

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
ANSWER_KEY_DIR = DATA_DIR / "answer_key"
# Raw downloads mix artifacts with answer-key rows, so they live under answer_key/.
RAW_DIR = ANSWER_KEY_DIR / "raw"

# Columns that OrgForge stores as JSON text, and what an empty value becomes.
JSON_COLUMNS: dict[str, Any] = {"actors": [], "tags": [], "artifact_ids": {}, "facts": {}}

# SINGLE SOURCE OF TRUTH for recovered artifacts.
# These rows have no category at all, but the OrgForge README's schema table
# defines these doc types as *artifacts* (real company documents: alerts,
# invoices, surveys), so they are written to artifacts.jsonl with
# source_category: null. Every other uncategorised doc type (datadog_metric,
# dept_plan, dept_plan_reasoning) is listed there as a simulation event and
# stays in the answer key.
RECOVERED_ARTIFACT_DOC_TYPES = frozenset({"datadog_alert", "invoice", "nps_survey"})

# Keys inside `facts` that describe simulator ground truth (what the simulator
# knows) rather than document content (what a reader of the document sees).
# They are removed from every artifact so the answer key cannot leak through.
STRIPPED_FACTS_KEYS = frozenset({
    # Departures and documentation coverage.
    "knowledge_domains", "documented_pct", "documentation_coverage", "live_documentation_coverage",
    "departed_employee", "former_owner", "days_since_departure", "orphaned_domains", "known_by",
    "is_genesis_gap",
    # Knowledge-gap detection and classification.
    "detection_method", "gap_classification", "gap_areas", "gap_domain", "involves_gap",
    "semantic_score", "escalation_harder", "triggered_by", "outcome", "outcome_at_write_time",
    "evidence", "asker", "asker_expertise",
    # The simulator's audit of who is qualified to write or review what.
    "author_domain_fit", "author_expertise", "reviewer_expertise",
    "topics_beyond_author_expertise", "topics_beyond_expertise",
    "hedged_claims", "deferred_or_incomplete", "deferred_sections",
    # Injected faults and incident recurrence chains (the agent must discover these).
    "system_fault", "recurrence_of", "recurrence_gap_days", "recurrence_chain_root",
    "recurrence_chain_depth", "prior_postmortem",
    # Whether a meeting later produced a document (knowledge of the future).
    "spawned_doc",
})

DEPARTURE_DOC_TYPES = frozenset({"employee_departed", "knowledge_gap_detected"})

#: Unicode dashes and spaces seen in timestamps and titles -> plain ASCII.
UNICODE_PUNCTUATION = str.maketrans({
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "−": "-",
    " ": " ", " ": " ",
})

SPRINT_PATTERN = re.compile(r"sprint\s*#?\s*(\d+)", re.IGNORECASE)
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ---------------------------------------------------------------- download


def list_dataset_files() -> list[str]:
    """Return every file path in the dataset repo (public, no token needed)."""
    api = HfApi()
    return sorted(api.list_repo_files(REPO_ID, repo_type=REPO_TYPE))


def download(path_in_repo: str) -> Path:
    """Download one file into data/answer_key/raw/, keeping its repo path."""
    local = hf_hub_download(REPO_ID, path_in_repo, repo_type=REPO_TYPE, local_dir=RAW_DIR)
    return Path(local)


def pick_files(files: list[str], folder: str, suffix: str) -> list[str]:
    """Files directly under `folder/` ending in `suffix`, as seen in the listing."""
    picked = [f for f in files if f.startswith(f"{folder}/") and f.endswith(suffix)]
    if not picked:
        raise SystemExit(f"No {suffix} files under {folder}/ in {REPO_ID}. Listing: {files}")
    return picked


# ---------------------------------------------------------------- parsing


def parse_json_cell(value: Any, empty: Any) -> Any:
    """Parse a JSON string; None, NaN and "" become `empty`. Bad JSON raises ValueError."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return empty
    if not isinstance(value, str):
        return value  # already parsed
    text = value.strip()
    if text in ("", "null", "None"):
        return empty
    return json.loads(text)


def parse_json_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Turn the JSON-as-text columns into real lists/dicts. Logs any unparseable cells."""
    df = df.copy()
    for column, empty in JSON_COLUMNS.items():
        failures = 0

        def parse(value: Any) -> Any:
            nonlocal failures
            try:
                return parse_json_cell(value, empty)
            except (json.JSONDecodeError, ValueError):
                failures += 1
                return empty

        df[column] = df[column].map(parse)
        if failures:
            print(f"  WARNING: {failures} unparseable values in '{column}' replaced with {empty!r}")
    return df


def clean_text(value: Any) -> str:
    """str(value) with Unicode dashes/spaces replaced by ASCII; None becomes ""."""
    return "" if value is None else str(value).strip().translate(UNICODE_PUNCTUATION)


def parse_timestamp(value: Any) -> pd.Timestamp:
    """OrgForge mixes ISO strings (with and without offset) and epoch seconds. Normalise to UTC."""
    text = clean_text(value)
    if text == "":  # a few rows have no timestamp at all; their day is inferred later
        return pd.NaT
    if text.isdigit():  # e.g. Datadog rows: "1771290900"
        return pd.Timestamp(datetime.fromtimestamp(int(text), tz=timezone.utc))
    stamp = pd.Timestamp(text)
    # Naive timestamps are treated as UTC so everything sorts on one clock.
    return stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp.tz_convert("UTC")


# ---------------------------------------------------------------- splitting


def report_categories(df: pd.DataFrame) -> None:
    """Print category counts, and one sample row for each unexpected category."""
    print("\nCategories:")
    counts = df["category"].fillna("(none)").value_counts()
    for category, count in counts.items():
        print(f"  {category:<12} {count:>6}")

    unexpected = [c for c in counts.index if c not in ("artifact", "sim_event")]
    for category in unexpected:
        rows = df[df["category"].isna()] if category == "(none)" else df[df["category"] == category]
        print(f"\nUnexpected category '{category}': doc types {rows['doc_type'].value_counts().to_dict()}")
        sample = rows.iloc[0].to_dict()
        print("  sample:", {k: str(v)[:120] for k, v in sample.items()})


def is_artifact(row: pd.Series) -> bool:
    """True for rows the product may load: real company documents only."""
    if row["category"] == "artifact":
        return True
    return pd.isna(row["category"]) and row["doc_type"] in RECOVERED_ARTIFACT_DOC_TYPES


def split_artifacts(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (artifacts, answer_key). Every row lands in exactly one of them."""
    mask = df.apply(is_artifact, axis=1)
    artifacts = df[mask].copy()
    answer_key = df[~mask].copy()

    recovered = artifacts["category"].isna()
    if recovered.any():
        by_type = artifacts.loc[recovered, "doc_type"].value_counts().to_dict()
        print(f"\nRecovered {int(recovered.sum())} uncategorised rows as artifacts: {by_type}")
    # Keep the original value for traceability, then mark them as artifacts.
    artifacts["source_category"] = artifacts["category"]
    artifacts["category"] = "artifact"
    return artifacts, answer_key


def dedupe_latest(artifacts: pd.DataFrame) -> pd.DataFrame:
    """Keep one row per doc_id: the one with the latest timestamp."""
    before = len(artifacts)
    # NaT sorts first here, so a row with a real timestamp always wins over one without.
    deduped = artifacts.sort_values("timestamp_utc", na_position="first").drop_duplicates("doc_id", keep="last")
    print(f"\nDe-duplicated artifacts on doc_id: dropped {before - len(deduped)} duplicates")
    return deduped


# ---------------------------------------------------------------- leakage scan


def facts_key_inventory(artifacts: pd.DataFrame) -> Counter[str]:
    """How many artifacts carry each key inside `facts`."""
    return Counter(key for facts in artifacts["facts"] for key in facts)


def print_facts_inventory(inventory: Counter[str]) -> None:
    print(f"\nKeys inside artifact facts ({len(inventory)} distinct; STRIP = simulator ground truth):")
    for key, count in inventory.most_common():
        flag = "STRIP" if key in STRIPPED_FACTS_KEYS else "keep "
        print(f"  {flag} {count:>5}  {key}")


def strip_ground_truth(artifacts: pd.DataFrame) -> tuple[pd.DataFrame, Counter[str]]:
    """Remove STRIPPED_FACTS_KEYS from every artifact's facts. Returns (artifacts, removed counts)."""
    removed: Counter[str] = Counter()

    def strip(facts: dict[str, Any]) -> dict[str, Any]:
        removed.update(key for key in facts if key in STRIPPED_FACTS_KEYS)
        return {k: v for k, v in facts.items() if k not in STRIPPED_FACTS_KEYS}

    artifacts = artifacts.copy()
    artifacts["facts"] = artifacts["facts"].map(strip)
    print(f"\nStripped {sum(removed.values())} ground-truth values ({len(removed)} keys) from artifact facts")
    return artifacts, removed


# ---------------------------------------------------------------- day inference


def linked_ids(row: pd.Series) -> set[str]:
    """doc_ids this artifact points at, via artifact_ids values or facts.causal_chain."""
    targets: set[str] = set()
    for value in row["artifact_ids"].values():
        targets.update(flatten_strings(value))
    targets.update(flatten_strings(row["facts"].get("causal_chain")))
    return targets


def flatten_strings(value: Any) -> list[str]:
    """Strings inside a value that may be a string, a list, or nested lists."""
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [s for item in value for s in flatten_strings(item)]
    return []


def sprint_number_of(row: pd.Series) -> int | None:
    """Sprint number from facts.sprint_number or from the title ("Sprint #4"). Body is not used."""
    if isinstance(row["facts"].get("sprint_number"), int):
        return row["facts"]["sprint_number"]
    match = SPRINT_PATTERN.search(clean_text(row["title"]))
    return int(match.group(1)) if match else None


def sprint_last_days(dated: pd.DataFrame) -> dict[int, tuple[int, int]]:
    """For each sprint number: (last day of any jira ticket in it, ticket count)."""
    jira = dated[dated["doc_type"] == "jira"]
    sprints: dict[int, list[int]] = {}
    for _, row in jira.iterrows():
        number = row["facts"].get("sprint_number")
        if isinstance(number, int):
            sprints.setdefault(number, []).append(int(row["day"]))
    return {number: (max(days), len(days)) for number, days in sprints.items()}


def infer_days(artifacts: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, list[dict[str, Any]]]:
    """
    Rows without a timestamp have an unreliable `day: 0`. Re-derive their day
    using ONLY other artifacts (never the answer key):
      1. links: artifacts it links to, or that link to it (artifact_ids,
         facts.causal_chain); take the earliest linked day.
      2. retros: sprint number in title/facts -> last day of that sprint's jira tickets.
      3. otherwise day: null, dayUnknown: true.
    Returns (dated rows, undated rows with their result, report table).
    """
    undated_mask = artifacts["timestamp_utc"].isna()
    dated = artifacts[~undated_mask]
    undated = artifacts[undated_mask].copy()

    day_by_id = dict(zip(dated["doc_id"], dated["day"].astype(int)))
    links_by_id = {row["doc_id"]: linked_ids(row) for _, row in artifacts.iterrows()}
    sprints = sprint_last_days(dated)

    results: list[dict[str, Any]] = []
    for index, row in undated.iterrows():
        doc_id = row["doc_id"]
        outgoing = links_by_id[doc_id]
        incoming = {other for other, targets in links_by_id.items() if doc_id in targets}
        candidates = sorted((day_by_id[d], d) for d in outgoing | incoming if d in day_by_id)

        if candidates:
            day, source = candidates[0]  # earliest linked day
            inferred_from = source
        elif (sprint := sprint_number_of(row)) is not None and sprint in sprints:
            day, tickets = sprints[sprint]
            inferred_from = f"sprint {sprint}: last day of its {tickets} jira tickets"
        else:
            day, inferred_from = None, None

        undated.at[index, "day"] = day
        undated.at[index, "dayInferred"] = day is not None
        undated.at[index, "inferredFrom"] = inferred_from
        undated.at[index, "dayUnknown"] = day is None
        results.append({"doc_id": doc_id, "doc_type": row["doc_type"], "day": day, "inferredFrom": inferred_from})

    undated["day"] = undated["day"].astype("object")  # keeps None instead of NaN
    return dated, undated.sort_values("doc_id"), results


def print_inference_table(results: list[dict[str, Any]]) -> None:
    print(f"\nDay inference for {len(results)} artifacts without a timestamp:")
    print(f"  {'doc_id':<16} {'doc_type':<14} {'day':>5}  inferred from")
    for r in results:
        day = "null" if r["day"] is None else str(r["day"])
        print(f"  {r['doc_id']:<16} {r['doc_type']:<14} {day:>5}  {r['inferredFrom'] or 'dayUnknown: no link, no sprint number'}")


# ---------------------------------------------------------------- calendar


def build_calendar(dated: pd.DataFrame) -> dict[str, Any]:
    """
    day -> date -> weekday, from artifact rows only. Days are business days.
    Day 0 is excluded: it is a catch-all bucket whose rows carry dates from the
    whole period. For each day the most common date wins; outliers are counted.
    """
    rows = dated[dated["day"] >= 1]
    days: list[dict[str, Any]] = []
    outliers = 0
    for day, group in rows.groupby("day"):
        dates = Counter(clean_text(d) for d in group["date"])
        chosen, votes = dates.most_common(1)[0]
        outliers += len(group) - votes
        weekday = date.fromisoformat(chosen).weekday()
        days.append({"day": int(day), "date": chosen, "weekday": WEEKDAYS[weekday]})

    check_calendar(days)
    print(f"\nCalendar: days {days[0]['day']}..{days[-1]['day']} = {days[0]['date']}..{days[-1]['date']} "
          f"({outliers} rows had a date different from their day's majority date)")
    return {
        "source": "artifacts.jsonl (majority date per day); day 0 excluded",
        "note": "Day numbers are business days (weekends skipped).",
        "days": days,
    }


def check_calendar(days: list[dict[str, Any]]) -> None:
    """Every day present, dates strictly increasing, no weekends."""
    numbers = [d["day"] for d in days]
    if numbers != list(range(numbers[0], numbers[-1] + 1)):
        raise SystemExit(f"Calendar has missing days: {numbers}")
    dates = [d["date"] for d in days]
    if dates != sorted(set(dates)):
        raise SystemExit("Calendar dates are not strictly increasing")
    weekend = [d for d in days if d["weekday"] in ("Saturday", "Sunday")]
    if weekend:
        raise SystemExit(f"Calendar contains weekend days: {weekend}")


# ---------------------------------------------------------------- departures


def extract_gap_event(row: pd.Series) -> dict[str, Any]:
    """Departure-related fields of one employee_departed / knowledge_gap_detected event."""
    facts: dict[str, Any] = row["facts"] or {}
    return {
        "doc_id": row["doc_id"],
        "doc_type": row["doc_type"],
        "day": int(row["day"]),
        # employee_departed uses "name"; genesis gap seeds use "former_owner";
        # later gap detections point at "departed_employee".
        "person": facts.get("name") or facts.get("former_owner") or facts.get("departed_employee"),
        "role": facts.get("role"),
        "domains": facts.get("knowledge_domains") or facts.get("domains") or facts.get("orphaned_domains"),
        "documentedPct": first_present(facts, "documented_pct", "documentation_coverage"),
        "isGenesisGap": bool(facts.get("is_genesis_gap", False)),
        "facts": facts,
    }


def first_present(facts: dict[str, Any], *keys: str) -> Any:
    """First key whose value is not None (0.0 is a valid percentage, so no `or`)."""
    for key in keys:
        if facts.get(key) is not None:
            return facts[key]
    return None


def build_departures(answer_key: pd.DataFrame) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(departed people, all gap events). People come from employee_departed rows only."""
    rows = answer_key[answer_key["doc_type"].isin(DEPARTURE_DOC_TYPES)]
    events = [extract_gap_event(row) for _, row in rows.iterrows()]
    people = [
        {
            "name": e["person"],
            "role": e["role"],
            "day": e["day"],
            "documentedPct": e["documentedPct"],
            "domains": e["domains"],
            "before_day_1": e["day"] < 1,
        }
        for e in sorted(events, key=lambda e: e["day"])
        if e["doc_type"] == "employee_departed"
    ]
    return people, events


def print_departures(people: list[dict[str, Any]]) -> None:
    print("\nDepartures (employee_departed):")
    for p in people:
        pct = "n/a" if p["documentedPct"] is None else f"{p['documentedPct']:.0%}"
        print(f"  day {p['day']:>5}  {p['name']:<8} {str(p['role'] or '-'):<14} documented {pct:>4}  {p['domains']}")
    print(f"  before day 1 (pre-simulation): {sum(p['before_day_1'] for p in people)}")
    print(f"  inside simulated days (>= 1):  {sum(not p['before_day_1'] for p in people)}")


# ---------------------------------------------------------------- writing


def to_jsonable(value: Any) -> Any:
    """json.dumps fallback for pandas/numpy values."""
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):  # numpy scalars (int64, bool_)
        return value.item()
    raise TypeError(f"Not JSON serialisable: {type(value)}")


def is_missing(value: Any) -> bool:
    """True for scalar None/NaN/NaT (lists and dicts are never 'missing')."""
    return not isinstance(value, (list, dict)) and pd.isna(value)


def write_jsonl(records: list[dict[str, Any]], path: Path) -> None:
    """One JSON object per line. Missing scalars become null; absent optional keys are dropped."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as out:
        for record in records:
            out.write(json.dumps(record, ensure_ascii=False, default=to_jsonable) + "\n")
    print(f"  wrote {path.relative_to(REPO_ROOT)} ({len(records)} rows)")


def frame_records(df: pd.DataFrame, optional: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """DataFrame -> dicts. Columns in `optional` are left out of rows where they are missing."""
    records = []
    for record in df.to_dict(orient="records"):
        clean = {}
        for key, value in record.items():
            if is_missing(value):
                if key in optional:
                    continue
                value = None
            clean[key] = value
        records.append(clean)
    return records


def write_json(data: Any, path: Path) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=to_jsonable) + "\n", encoding="utf-8")
    print(f"  wrote {path.relative_to(REPO_ROOT)}")


def write_stats(
    df: pd.DataFrame,
    artifacts: pd.DataFrame,
    inference: list[dict[str, Any]],
    stripped: Counter[str],
    calendar: dict[str, Any],
    path: Path,
) -> None:
    """Summary of the corpus. Actor and department figures come from artifacts only."""
    categories = df["category"].fillna("(none)").value_counts()
    doc_types = artifacts["doc_type"].value_counts()
    actors = sorted({actor for row in artifacts["actors"] for actor in row})
    depts = sorted({d for d in artifacts["dept"].dropna() if str(d).strip()})
    known_days = [int(d) for d in artifacts["day"] if not is_missing(d)]
    recovered = int(artifacts["source_category"].isna().sum())
    first, last = calendar["days"][0], calendar["days"][-1]

    lines = [
        "# OrgForge corpus stats",
        "",
        f"Generated by `scripts/prepare_orgforge.py` from `{REPO_ID}`.",
        "",
        f"- Total rows: **{len(df)}**",
        f"- Artifacts written: **{len(artifacts)}** "
        f"({len(artifacts) - recovered} with category `artifact` + {recovered} recovered "
        f"`{', '.join(sorted(RECOVERED_ARTIFACT_DOC_TYPES))}`)",
        f"- Day range, all rows: **{df['day'].min()} to {df['day'].max()}**",
        f"- Day range, artifacts: **{min(known_days)} to {max(known_days)}**",
        f"- Calendar: day {first['day']} = {first['date']} ({first['weekday']}) "
        f"to day {last['day']} = {last['date']} ({last['weekday']}), business days only",
        f"- Distinct actors in artifacts: **{len(actors)}**",
        f"- Artifacts with no timestamp: **{len(inference)}** "
        f"({sum(r['day'] is not None for r in inference)} day inferred, "
        f"{sum(r['day'] is None for r in inference)} dayUnknown)",
        "",
        "## Rows by category",
        "",
        "| Category | Rows |",
        "| --- | ---: |",
        *[f"| {c} | {n} |" for c, n in categories.items()],
        "",
        "## Artifacts by doc_type",
        "",
        "| doc_type | Rows |",
        "| --- | ---: |",
        *[f"| {t} | {n} |" for t, n in doc_types.items()],
        "",
        "## Inferred days",
        "",
        "| doc_id | doc_type | day | inferred from |",
        "| --- | --- | ---: | --- |",
        *[f"| {r['doc_id']} | {r['doc_type']} | {'null' if r['day'] is None else r['day']} | "
          f"{r['inferredFrom'] or 'dayUnknown'} |" for r in inference],
        "",
        "## Ground-truth keys stripped from artifact facts",
        "",
        "These `facts` keys describe what the simulator knows, not what the document says.",
        "",
        "| Key | Values removed |",
        "| --- | ---: |",
        *[f"| {k} | {n} |" for k, n in stripped.most_common()],
        f"| **total** | **{sum(stripped.values())}** |",
        "",
        f"## Departments ({len(depts)})",
        "",
        *[f"- {d}" for d in depts],
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  wrote {path.relative_to(REPO_ROOT)}")


# ---------------------------------------------------------------- self-check


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def self_check() -> None:
    """Re-read the written files and assert the safety rules. Exits non-zero on failure."""
    print("\nSelf-check (re-reading written files):")
    artifacts = read_jsonl(DATA_DIR / "artifacts.jsonl")
    artifact_ids = {row["doc_id"] for row in artifacts}

    # 1. No answer-key row (anything with a doc_id under answer_key/, raw/ excluded) is an artifact.
    answer_ids: set[str] = set()
    for path in sorted(ANSWER_KEY_DIR.glob("*.jsonl")):
        answer_ids.update(row["doc_id"] for row in read_jsonl(path) if "doc_id" in row)
    overlap = artifact_ids & answer_ids
    report_check(not overlap, f"no doc_id shared between artifacts.jsonl and answer_key/*.jsonl "
                              f"({len(artifact_ids)} vs {len(answer_ids)} ids)", overlap)

    # 2. No stripped facts key survived.
    leftovers = sorted({key for row in artifacts for key in row["facts"] if key in STRIPPED_FACTS_KEYS})
    report_check(not leftovers, "no stripped facts key remains in artifacts.jsonl", leftovers)

    # 3. Every artifact has an integer day, or is explicitly marked dayUnknown.
    bad_days = [row["doc_id"] for row in artifacts
                if not (isinstance(row["day"], int) or row.get("dayUnknown") is True)]
    report_check(not bad_days, "every artifact has an integer day or dayUnknown: true", bad_days)


def report_check(passed: bool, label: str, offenders: Any) -> None:
    print(f"  {'PASS' if passed else 'FAIL'}  {label}")
    if not passed:
        raise SystemExit(f"Self-check failed: {label}. Offenders: {list(offenders)[:20]}")


# ---------------------------------------------------------------- main


def main() -> None:
    print(f"Files in {REPO_ID}:")
    files = list_dataset_files()
    for f in files:
        print(f"  {f}")

    corpus_files = pick_files(files, "corpus", ".parquet")
    question_files = pick_files(files, "questions", ".jsonl")

    print("\nDownloading:")
    corpus_paths = [download(f) for f in corpus_files]
    question_paths = [download(f) for f in question_files]
    for path in corpus_paths + question_paths:
        print(f"  {path.relative_to(REPO_ROOT)}")

    df = pd.concat([pd.read_parquet(p) for p in corpus_paths], ignore_index=True)
    print(f"\nLoaded {len(df)} rows, columns: {list(df.columns)}")
    df = parse_json_columns(df)
    df["timestamp_utc"] = df["timestamp"].map(parse_timestamp)

    report_categories(df)
    artifacts, answer_key = split_artifacts(df)
    artifacts = dedupe_latest(artifacts)

    print_facts_inventory(facts_key_inventory(artifacts))
    artifacts, stripped = strip_ground_truth(artifacts)

    dated, undated, inference = infer_days(artifacts)
    print_inference_table(inference)
    calendar = build_calendar(dated)

    # Dated rows sorted by time (doc_id breaks ties); undated rows go at the end.
    dated = dated.sort_values(["timestamp_utc", "doc_id"], kind="stable")
    artifacts = pd.concat([dated, undated], ignore_index=True)
    # Mixing ints with None makes pandas store days as floats (11.0); force real ints.
    artifacts["day"] = pd.Series([None if is_missing(d) else int(d) for d in artifacts["day"]], dtype="object")
    answer_key = answer_key.sort_values(["timestamp_utc", "doc_id"], na_position="last", kind="stable")

    print("\nWriting:")
    write_jsonl(frame_records(artifacts, optional=("dayInferred", "inferredFrom", "dayUnknown")),
                DATA_DIR / "artifacts.jsonl")
    write_json(calendar, DATA_DIR / "calendar.json")
    write_jsonl(frame_records(answer_key), ANSWER_KEY_DIR / "sim_events.jsonl")

    # Questions are copied byte for byte ("as provided"); several files are concatenated.
    questions_out = ANSWER_KEY_DIR / "questions.jsonl"
    with questions_out.open("wb") as out:
        for path in question_paths:
            with path.open("rb") as src:
                shutil.copyfileobj(src, out)
    print(f"  wrote {questions_out.relative_to(REPO_ROOT)} ({len(read_jsonl(questions_out))} questions)")

    people, events = build_departures(answer_key)
    write_json(people, ANSWER_KEY_DIR / "departures.json")
    write_jsonl(events, ANSWER_KEY_DIR / "gap_events.jsonl")

    write_stats(df, artifacts, inference, stripped, calendar, DATA_DIR / "stats.md")
    print_departures(people)
    self_check()


if __name__ == "__main__":
    main()
