"""Download the OrgForge "Apex Athletics" dataset and split it into safe files.

Usage (from the repo root):
    python3.12 -m venv scripts/.venv
    scripts/.venv/bin/pip install -r scripts/requirements.txt
    scripts/.venv/bin/python scripts/prepare_orgforge.py

Outputs (see scripts/README.md):
    data/artifacts.jsonl                 the ONLY file the product may load
    data/calendar.json                   simulation day -> date and weekday (business days)
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
from datetime import date, datetime, timedelta, timezone
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

# SINGLE SOURCE OF TRUTH for artifact tags: an allowlist.
# A tag is kept only if it says what a document is or where it came from
# (channel, doc type, direction, department, sender, work type). Tags that
# encode simulator state, lifecycle or outcomes are dropped, and so is any tag
# not listed here. Each entry: tag -> (keep?, one-line reason).
TAG_DECISIONS: dict[str, tuple[bool, str]] = {
    # Channel or document type.
    "slack": (True, "channel / doc type"),
    "email": (True, "channel / doc type"),
    "confluence": (True, "channel / doc type"),
    "jira": (True, "channel / doc type"),
    "zoom": (True, "channel / doc type"),
    "transcript": (True, "doc type (meeting transcript)"),
    "datadog": (True, "source system of the alert"),
    "alert": (True, "doc type"),
    "invoice": (True, "doc type"),
    "zendesk": (True, "source system of the ticket"),
    "nps": (True, "doc type (survey)"),
    "salesforce": (True, "source system of the record"),
    # Direction and business area.
    "inbound": (True, "message direction"),
    "outbound": (True, "message direction"),
    "vendor": (True, "counterparty type"),
    "customer": (True, "counterparty type"),
    "sales": (True, "business area"),
    "billing": (True, "business area"),
    "support": (True, "business area"),
    "hr": (True, "business area"),
    # Departments.
    "engineering": (True, "department"),
    "engineering_backend": (True, "department"),
    "engineering_mobile": (True, "department"),
    "design": (True, "department"),
    "product": (True, "department"),
    "qa_support": (True, "department"),
    "hr_ops": (True, "department"),
    "sales_marketing": (True, "department"),
    # Kind of email / record.
    "vendor_ack": (True, "email kind"),
    "general_inquiry": (True, "email kind"),
    "customer_reply": (True, "email kind"),
    "feature_request": (True, "email kind"),
    "question": (True, "email / ticket kind"),
    "offer_letter": (True, "email kind"),
    "touchpoint": (True, "CRM record kind"),
    # Work type, as written on the document.
    "sprint_backlog": (True, "work type"),
    "design_discussion": (True, "meeting kind"),
    "pr_review": (True, "work type"),
    "postmortem": (True, "doc kind"),
    "incident": (True, "doc kind"),
    "P1": (True, "severity written on the incident itself"),
    "detractor": (True, "NPS bucket shown on the survey"),
    "passive": (True, "NPS bucket shown on the survey"),
    # External contacts an email came from (same as its from_addr).
    "ethan": (True, "sender (external contact)"),
    "yara": (True, "sender (external contact)"),
    "nora": (True, "sender (external contact)"),
    "mona": (True, "sender (external contact)"),
    "lena": (True, "sender (external contact)"),
    "arun": (True, "sender (external contact)"),
    "ravi": (True, "sender (external contact)"),
    "nisha": (True, "sender (external contact)"),
    "isabel": (True, "sender (external contact)"),
    # Simulator state, lifecycle and outcomes: dropped.
    "causal_chain": (False, "simulator provenance link"),
    "knowledge_gap": (False, "simulator gap detection"),
    "reviewer_audit": (False, "simulator audit of the PR"),
    "recurrence": (False, "simulator recurrence outcome"),
    "departed_employee": (False, "simulator departure state"),
    "async_question": (False, "sim_event type name; only on knowledge-gap records"),
    "documentation": (False, "only on a simulator knowledge-gap record"),
    "escalation": (False, "ticket lifecycle outcome"),
    "orphaned_domain": (False, "simulator ownership state"),
    "genesis": (False, "simulator pre-history marker"),
    "lifecycle": (False, "simulator lifecycle marker"),
    "": (False, "empty string, not a tag"),
}
KEPT_TAGS = frozenset(tag for tag, (keep, _) in TAG_DECISIONS.items() if keep)
UNKNOWN_TAG_REASON = "not in TAG_DECISIONS (unknown tags default to drop)"

#: Unicode dashes and spaces seen in timestamps and titles -> plain ASCII.
UNICODE_PUNCTUATION = str.maketrans({
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "−": "-",
    " ": " ", " ": " ",
})

SPRINT_PATTERN = re.compile(r"sprint\s*#?\s*(\d+)", re.IGNORECASE)

# Simulator annotations the generator appended to incident titles and bodies,
# e.g. "[TitanDB, legacy auth service undocumented]" (a knowledge-gap label) and
# "[recurrence of ENG-112]" (a recurrence label). They are answer-key data that
# leaked into document text, so they are scrubbed from title and body.
SIMULATOR_ANNOTATION = re.compile(r"\s*\[[^\[\]]*\bundocumented\]|\s*\[recurrence of [A-Z]+-\d+\]")

# A few rows are not documents at all: their whole body is a simulator
# knowledge-gap record ("gap_areas: ..."). They are moved to the answer key.
SIMULATOR_RECORD_BODY = re.compile(r"^\s*gap_areas\s*:")

# PR bodies written as the simulator's reviewer-audit record. Rewritten to the
# neutral facts they contain (who submitted which PR, who reviewed it); the
# expertise, fit and gap labels are answer-key data and are dropped.
PR_AUDIT_BODY = re.compile(
    r"^Knowledge gap detected via reviewer audit: (?P<author>.+?) \(expertise: [^)]*\) "
    r"submitted PR '(?P<title>.+)' with fit=\w+, gap=\w+\. Reviewed by (?P<reviewer>.+?)\.\s*$",
    re.DOTALL,
)

# Confluence pages that kept the generator's internal metadata block
# ("metadata": {"author_domain_fit": ..., "gap_classification": ..., ...}).
PAGE_METADATA_BLOCK = re.compile(r',?\s*"metadata"\s*:\s*\{[^{}]*?"author_domain_fit"[^{}]*\}', re.DOTALL)

# Pages that kept a "Self-Audit (internal - not part of the doc)" section.
PAGE_SELF_AUDIT = re.compile(
    r"#+\s*Self.Audit[^\n]*\n(?:\*(?:Topics beyond|Hedged claims|Deferred or incomplete)[^\n]*\n?)+",
    re.IGNORECASE,
)

# Anything still matching this after scrubbing is ground truth in document text.
GROUND_TRUTH_TEXT = re.compile(
    r"author_domain_fit|gap_classification|topics_beyond_author_expertise|topics beyond author expertise"
    r"|knowledge gap detected via reviewer audit|fit=\w+, gap=\w+",
    re.IGNORECASE,
)
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


def scrub_simulator_text(artifacts: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """
    Remove answer-key text that leaked into documents:
      - rows whose body is a simulator record move to the answer key;
      - simulator annotations are cut out of every title and body.
    Returns (kept artifacts, rows moved to the answer key, summary).
    """
    is_record = artifacts["body"].map(lambda body: bool(SIMULATOR_RECORD_BODY.match(body or "")))
    moved = artifacts[is_record].copy()
    kept = artifacts[~is_record].copy()

    counts: Counter[str] = Counter()

    def scrub(text: Any, field: str) -> Any:
        if not isinstance(text, str):
            return text
        cleaned, n = SIMULATOR_ANNOTATION.subn("", text)
        counts[field] += n
        return cleaned

    def scrub_body(text: Any) -> Any:
        if not isinstance(text, str):
            return text
        audit = PR_AUDIT_BODY.match(text)
        if audit:
            counts["pr_audit"] += 1
            text = f"{audit['author']} submitted PR '{audit['title']}'. Reviewed by {audit['reviewer']}."
        text, n = PAGE_METADATA_BLOCK.subn("", text)
        counts["metadata"] += n
        text, n = PAGE_SELF_AUDIT.subn("", text)
        counts["self_audit"] += n
        return scrub(text, "body")

    kept["title"] = kept["title"].map(lambda t: scrub(t, "title"))
    kept["body"] = kept["body"].map(scrub_body)
    summary = {"moved": sorted(moved["doc_id"]), "titles": counts["title"], "bodies": counts["body"],
               "pr_audit": counts["pr_audit"], "metadata": counts["metadata"], "self_audit": counts["self_audit"]}
    print(f"\nSimulator text: moved {len(moved)} record rows to the answer key {summary['moved']}; "
          f"scrubbed {counts['title']} title and {counts['body']} body annotations; rewrote {counts['pr_audit']} "
          f"PR audit bodies; removed {counts['metadata']} page metadata blocks and {counts['self_audit']} self-audit sections")
    return kept, moved, summary


# ---------------------------------------------------------------- tags


def tag_inventory(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every distinct tag with its count, two example doc_ids, and the keep/drop verdict."""
    counts: Counter[str] = Counter()
    examples: dict[str, list[str]] = {}
    for row in records:
        for tag in row["tags"]:
            counts[tag] += 1
            examples.setdefault(tag, [])
            if len(examples[tag]) < 2:
                examples[tag].append(row["doc_id"])

    report = []
    for tag, count in counts.most_common():
        keep, reason = TAG_DECISIONS.get(tag, (False, UNKNOWN_TAG_REASON))
        report.append({"tag": tag, "count": count, "examples": examples[tag], "keep": keep, "reason": reason})
    return report


def print_tag_report(report: list[dict[str, Any]]) -> None:
    print(f"\nTags in artifacts ({len(report)} distinct), classification BEFORE writing:")
    print(f"  {'verdict':<7} {'count':>5}  {'tag':<20} {'reason':<52} examples")
    for t in report:
        verdict = "keep" if t["keep"] else "DROP"
        print(f"  {verdict:<7} {t['count']:>5}  {t['tag']!r:<20} {t['reason']:<52} {', '.join(t['examples'])}")


def filter_tags(records: list[dict[str, Any]]) -> None:
    """Keep only tags in KEPT_TAGS (in place)."""
    for row in records:
        row["tags"] = [tag for tag in row["tags"] if tag in KEPT_TAGS]


# ---------------------------------------------------------------- calendar


def row_date(date_value: Any) -> date | None:
    """
    The calendar date of a row, from the `date` column ONLY. It always agrees
    with `day` on genuine day >= 1 rows, while timestamps and Slack doc_ids can
    run 1-12 days later, so timestamps are used only to order rows within a day.
    (Every artifact that has a timestamp also has a date.)
    """
    try:
        return date.fromisoformat(clean_text(date_value))
    except ValueError:
        return None


def add_business_days(start: date, count: int) -> date:
    """`count` weekdays after `start` (count may be 0)."""
    current = start
    while count > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            count -= 1
    return current


def build_calendar(records: list[dict[str, Any]]) -> dict[str, Any]:
    """
    day -> date -> weekday, from trustworthy rows only: genuine artifacts with
    day >= 1 that have a date. Recovered rows (RECOVERED_ARTIFACT_DOC_TYPES) are
    excluded because their days are placeholders. Majority date per day;
    conflicts are printed. Missing days
    are filled by business-day arithmetic, and every known day must agree with
    that arithmetic or the script stops.
    """
    votes: dict[int, Counter[date]] = {}
    for row in records:
        trustworthy = row["source_category"] is not None  # not a recovered row
        if trustworthy and isinstance(row["day"], int) and row["day"] >= 1 and row["date_value"] is not None:
            votes.setdefault(row["day"], Counter())[row["date_value"]] += 1

    anchors: dict[int, date] = {}
    for day in sorted(votes):
        anchors[day] = votes[day].most_common(1)[0][0]
        if len(votes[day]) > 1:
            print(f"  calendar conflict on day {day}: "
                  f"{ {d.isoformat(): n for d, n in votes[day].most_common()} } -> majority {anchors[day]}")

    first_day, last_day = min(anchors), max(anchors)
    first_date = anchors[first_day]
    days, mismatches = [], []
    for day in range(first_day, last_day + 1):
        expected = add_business_days(first_date, day - first_day)
        if day in anchors and anchors[day] != expected:
            mismatches.append(f"day {day}: data says {anchors[day]}, business days say {expected}")
        days.append({
            "day": day,
            "date": expected.isoformat(),
            "weekday": WEEKDAYS[expected.weekday()],
            "source": "artifacts" if day in anchors else "filled",
        })
    if mismatches:
        print("\n".join(f"  CALENDAR MISMATCH {m}" for m in mismatches))
        raise SystemExit("Calendar anchors disagree with business-day arithmetic; stopping.")

    filled = [d["day"] for d in days if d["source"] == "filled"]
    print(f"\nCalendar: day {first_day} = {days[0]['date']} ({days[0]['weekday']}) .. day {last_day} = "
          f"{days[-1]['date']} ({days[-1]['weekday']}); {len(anchors)} days from data, {len(filled)} filled {filled}")
    return {
        "source": "genuine artifacts.jsonl rows with day >= 1 and a date (majority per day); "
                  "gaps filled by business days",
        "note": "Day numbers are business days (weekends skipped). Convert only through this file.",
        "firstDay": first_day,
        "lastDay": last_day,
        "firstDate": days[0]["date"],
        "lastDate": days[-1]["date"],
        "days": days,
    }


class CalendarIndex:
    """Fast lookups over calendar.json: date -> day and day -> date."""

    def __init__(self, calendar: dict[str, Any]):
        self.first_date = date.fromisoformat(calendar["firstDate"])
        self.last_date = date.fromisoformat(calendar["lastDate"])
        self.day_by_date = {date.fromisoformat(d["date"]): d["day"] for d in calendar["days"]}
        self.date_by_day = {d["day"]: date.fromisoformat(d["date"]) for d in calendar["days"]}

    def nearest_previous_day(self, when: date) -> int:
        """The calendar day just before a weekend date (Saturday/Sunday -> Friday)."""
        return max(day for d, day in self.day_by_date.items() if d <= when)


# ---------------------------------------------------------------- day remapping


def remap_days(records: list[dict[str, Any]], cal: CalendarIndex) -> dict[str, Any]:
    """
    Fix days the dataset got wrong, using each row's date and the calendar:
      - date after the last simulated date: that is the dataset's generation
        date, not a document date. Keep it as rawDate, clear `date`, and let
        infer_days() place the row like any other undated row.
      - day 0 (most Slack and Confluence rows) and recovered rows (placeholder
        days such as 30): move to the date's calendar day, dayInferred "calendar".
        A weekend date goes to the previous business day ("calendar-nearest");
        a date before the simulation keeps day 0 ("pre-sim").
      - genuine day >= 1 rows are only checked, never changed.
    Returns a summary for stats.md.
    """
    post_sim, weekend, mismatches = [], [], []
    for row in records:
        when = row["date_value"]
        if when is None:
            continue  # no date at all; handled by infer_days()
        if when > cal.last_date:
            row["rawDate"] = row["date"]
            row["date"] = None
            row["date_value"] = None
            post_sim.append(row["doc_id"])
            continue
        needs_remap = row["day"] == 0 or row["source_category"] is None
        if not needs_remap:
            if cal.date_by_day.get(row["day"]) != when:
                mismatches.append(row)
        elif when < cal.first_date:
            row["dayInferred"] = "pre-sim"  # a document older than the simulation keeps day 0
        elif when in cal.day_by_date:
            set_inferred_day(row, cal.day_by_date[when], "calendar")
        else:
            set_inferred_day(row, cal.nearest_previous_day(when), "calendar-nearest")
            weekend.append(row["doc_id"])

    for row in mismatches:
        print(f"  MISMATCH {row['doc_id']:<16} {row['doc_type']:<12} day {row['day']} "
              f"(= {cal.date_by_day.get(row['day'])}) but date {row['date_value']}")
    print(f"\nRemap: {len(post_sim)} post-simulation dates cleared {post_sim}; "
          f"{len(weekend)} weekend dates -> previous business day; "
          f"{len(mismatches)} genuine rows disagree with the calendar")
    return {"post_sim": post_sim, "nearest_weekend": weekend, "genuine_mismatches": [r["doc_id"] for r in mismatches]}


def set_inferred_day(row: dict[str, Any], day: int | None, how: str, source: str | None = None) -> None:
    """Record a corrected day, remembering the day the dataset gave (originalDay)."""
    row["originalDay"] = row["day"]
    row["day"] = day
    row["dayInferred"] = how
    if source is not None:
        row["inferredFrom"] = source


# ---------------------------------------------------------------- day inference


def linked_ids(row: dict[str, Any]) -> set[str]:
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


def sprint_number_of(row: dict[str, Any]) -> int | None:
    """Sprint number from facts.sprint_number or from the title ("Sprint #4"). Body is not used."""
    if isinstance(row["facts"].get("sprint_number"), int):
        return row["facts"]["sprint_number"]
    match = SPRINT_PATTERN.search(clean_text(row["title"]))
    return int(match.group(1)) if match else None


def sprint_last_days(records: list[dict[str, Any]]) -> dict[int, tuple[int, int]]:
    """For each sprint number: (last day of any jira ticket in it, ticket count)."""
    sprints: dict[int, list[int]] = {}
    for row in records:
        number = row["facts"].get("sprint_number")
        if row["doc_type"] == "jira" and isinstance(number, int) and isinstance(row["day"], int):
            sprints.setdefault(number, []).append(row["day"])
    return {number: (max(days), len(days)) for number, days in sprints.items()}


def infer_days(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Rows with no usable date (none at all, or a post-simulation date cleared
    by remap_days) have a meaningless day. Re-derive
    their day from the (already corrected) days of OTHER artifacts only:
      1. link: artifacts it links to or that link to it (artifact_ids,
         facts.causal_chain); the earliest linked day wins.
      2. sprint: sprint number in title/facts -> last day of that sprint's jira tickets.
      3. otherwise day: null, dayUnknown: true.
    Updates rows in place and returns a report table.
    """
    undated = [row for row in records if row["date_value"] is None]
    undated_ids = {row["doc_id"] for row in undated}
    day_by_id = {row["doc_id"]: row["day"] for row in records
                 if row["doc_id"] not in undated_ids and isinstance(row["day"], int)}
    links_by_id = {row["doc_id"]: linked_ids(row) for row in records}
    sprints = sprint_last_days(records)

    results = []
    for row in sorted(undated, key=lambda r: r["doc_id"]):
        doc_id = row["doc_id"]
        incoming = {other for other, targets in links_by_id.items() if doc_id in targets}
        candidates = sorted((day_by_id[d], d) for d in links_by_id[doc_id] | incoming if d in day_by_id)

        if candidates:
            day, source = candidates[0]
            set_inferred_day(row, day, "link", source)
        elif (sprint := sprint_number_of(row)) is not None and sprint in sprints:
            day, tickets = sprints[sprint]
            set_inferred_day(row, day, "sprint", f"sprint {sprint}: last day of its {tickets} jira tickets")
        else:
            row["originalDay"] = row["day"]
            row["day"] = None
            row["dayUnknown"] = True
        results.append({"doc_id": doc_id, "doc_type": row["doc_type"], "day": row["day"],
                        "inferredFrom": row.get("inferredFrom")})
    return results


def print_inference_table(results: list[dict[str, Any]]) -> None:
    print(f"\nDay inference for {len(results)} artifacts with no usable date:")
    print(f"  {'doc_id':<16} {'doc_type':<14} {'day':>5}  inferred from")
    for r in results:
        day = "null" if r["day"] is None else str(r["day"])
        print(f"  {r['doc_id']:<16} {r['doc_type']:<14} {day:>5}  {r['inferredFrom'] or 'dayUnknown: no link, no sprint number'}")


def sort_artifacts(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """By (day, timestamp, doc_id); rows without a timestamp last within their day; dayUnknown last."""
    def key(row: dict[str, Any]) -> tuple[Any, ...]:
        stamp = row["timestamp_utc"]
        has_stamp = isinstance(stamp, pd.Timestamp) and not pd.isna(stamp)
        return (row["day"] is None, row["day"] or 0, not has_stamp, stamp.value if has_stamp else 0, row["doc_id"])
    return sorted(records, key=key)


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


def frame_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """DataFrame -> dicts, with missing scalars (NaN, NaT) turned into None."""
    records = []
    for record in df.to_dict(orient="records"):
        clean = {}
        for key, value in record.items():
            clean[key] = None if is_missing(value) else value
        records.append(clean)
    return records


def write_json(data: Any, path: Path) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=to_jsonable) + "\n", encoding="utf-8")
    print(f"  wrote {path.relative_to(REPO_ROOT)}")


def write_stats(
    df: pd.DataFrame,
    artifacts: list[dict[str, Any]],
    tag_report: list[dict[str, Any]],
    inference: list[dict[str, Any]],
    stripped: Counter[str],
    calendar: dict[str, Any],
    remap: dict[str, Any],
    scrubbed: dict[str, Any],
    path: Path,
) -> None:
    """Summary of the corpus. Actor and department figures come from artifacts only."""
    categories = df["category"].fillna("(none)").value_counts()
    doc_types = Counter(row["doc_type"] for row in artifacts)
    actors = sorted({actor for row in artifacts for actor in row["actors"]})
    depts = sorted({row["dept"] for row in artifacts if row["dept"] and str(row["dept"]).strip()})
    recovered = sum(row["source_category"] is None for row in artifacts)
    per_day = Counter(row["day"] for row in artifacts)
    inferred = Counter(
        row.get("dayInferred") or ("(dayUnknown)" if row.get("dayUnknown") else "(none: genuine day)")
        for row in artifacts
    )
    date_by_day = {d["day"]: d["date"] for d in calendar["days"]}
    widest = max(per_day[d] for d in range(0, calendar["lastDay"] + 1)) or 1

    lines = [
        "# OrgForge corpus stats",
        "",
        f"Generated by `scripts/prepare_orgforge.py` from `{REPO_ID}`.",
        "",
        f"- Total rows: **{len(df)}**",
        f"- Artifacts written: **{len(artifacts)}** ({len(artifacts) - recovered} with category `artifact` "
        f"+ {recovered} recovered `{', '.join(sorted(RECOVERED_ARTIFACT_DOC_TYPES))}`)",
        f"- Simulated period: day {calendar['firstDay']} = **{calendar['firstDate']}** to "
        f"day {calendar['lastDay']} = **{calendar['lastDate']}** (business days only)",
        f"- Distinct actors in artifacts: **{len(actors)}**",
        f"- Simulator records moved to the answer key: **{len(scrubbed['moved'])}** {scrubbed['moved']}; "
        f"annotations scrubbed: **{scrubbed['titles']}** titles, **{scrubbed['bodies']}** bodies; "
        f"PR audit bodies rewritten: **{scrubbed['pr_audit']}**; page metadata blocks removed: "
        f"**{scrubbed['metadata']}**; self-audit sections removed: **{scrubbed['self_audit']}**",
        f"- Weekend dates mapped to the previous business day: **{len(remap['nearest_weekend'])}**",
        f"- Post-simulation dates treated as no date (kept as `rawDate`): "
        f"**{len(remap['post_sim'])}** {remap['post_sim']}",
        f"- Genuine day >= 1 rows whose date disagrees with the calendar (left unchanged): "
        f"**{len(remap['genuine_mismatches'])}**",
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
        *[f"| {t} | {n} |" for t, n in doc_types.most_common()],
        "",
        "## Artifacts by dayInferred",
        "",
        "| dayInferred | Rows |",
        "| --- | ---: |",
        *[f"| {k} | {n} |" for k, n in inferred.most_common()],
        "",
        "## Artifacts per day",
        "",
        "| Day | Date | Artifacts | |",
        "| ---: | --- | ---: | --- |",
        *[f"| {d} | {date_by_day.get(d, '-')} | {per_day[d]} | {'#' * round(40 * per_day[d] / widest)} |"
          for d in range(0, calendar["lastDay"] + 1)],
        f"| null | - | {per_day[None]} | (dayUnknown) |",
        "",
        "## Rows with no usable date",
        "",
        "| doc_id | doc_type | day | inferred from |",
        "| --- | --- | ---: | --- |",
        *[f"| {r['doc_id']} | {r['doc_type']} | {'null' if r['day'] is None else r['day']} | "
          f"{r['inferredFrom'] or 'dayUnknown'} |" for r in inference],
        "",
        "## Tags (allowlist `KEPT_TAGS`)",
        "",
        "| Tag | Count | Verdict | Reason |",
        "| --- | ---: | --- | --- |",
        *[f"| `{t['tag']}` | {t['count']} | {'keep' if t['keep'] else '**drop**'} | {t['reason']} |"
          for t in tag_report],
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
    cal = CalendarIndex(json.loads((DATA_DIR / "calendar.json").read_text(encoding="utf-8")))
    artifact_ids = {row["doc_id"] for row in artifacts}

    # 1. Tags come only from the allowlist.
    bad_tags = sorted({tag for row in artifacts for tag in row["tags"] if tag not in KEPT_TAGS})
    report_check(not bad_tags, "no tag outside KEPT_TAGS appears in artifacts.jsonl", bad_tags)

    # 2. Day 0 only for documents older than the simulation.
    bad_zero = [row["doc_id"] for row in artifacts if row["day"] == 0 and not (
        row.get("dayInferred") == "pre-sim"
        or ("dayInferred" not in row and (d := row_date(row["date"])) and d < cal.first_date)
    )]
    report_check(not bad_zero, "no artifact has day 0 unless it pre-dates the simulation", bad_zero)

    # 3. Day agrees with calendar.json for every row that has a date. No exceptions.
    inconsistent = []
    for row in artifacts:
        when = row_date(row["date"])
        if when is None:
            continue
        if when < cal.first_date:
            expected = 0
        elif when in cal.day_by_date:
            expected = cal.day_by_date[when]
        elif when.weekday() >= 5 and when < cal.last_date:
            expected = cal.nearest_previous_day(when)
        else:
            expected = None  # a post-simulation date must have been cleared into rawDate
        if row["day"] != expected:
            inconsistent.append(f"{row['doc_id']} (day {row['day']}, date {when})")
    report_check(not inconsistent, "every artifact with a date has a day consistent with calendar.json "
                                   "(expected disagreements: 0)", inconsistent)

    # 4a. No simulator annotation or simulator-record body left in any document.
    annotated = [row["doc_id"] for row in artifacts
                 if SIMULATOR_ANNOTATION.search(row["title"] or "") or SIMULATOR_ANNOTATION.search(row["body"] or "")
                 or SIMULATOR_RECORD_BODY.match(row["body"] or "")
                 or GROUND_TRUTH_TEXT.search(row["title"] or "") or GROUND_TRUTH_TEXT.search(row["body"] or "")]
    report_check(not annotated, "no simulator annotations, record bodies or audit text remain in artifact text", annotated)

    # 4. No answer-key row (anything with a doc_id under answer_key/, raw/ excluded) is an artifact.
    answer_ids: set[str] = set()
    for path in sorted(ANSWER_KEY_DIR.glob("*.jsonl")):
        answer_ids.update(row["doc_id"] for row in read_jsonl(path) if "doc_id" in row)
    overlap = artifact_ids & answer_ids
    report_check(not overlap, f"no doc_id shared between artifacts.jsonl and answer_key/*.jsonl "
                              f"({len(artifact_ids)} vs {len(answer_ids)} ids)", overlap)

    # 5. No stripped facts key survived.
    leftovers = sorted({key for row in artifacts for key in row["facts"] if key in STRIPPED_FACTS_KEYS})
    report_check(not leftovers, "no stripped facts key remains in artifacts.jsonl", leftovers)

    # 6. Every artifact has an integer day, or is explicitly marked dayUnknown.
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
    artifact_frame, answer_key = split_artifacts(df)
    artifact_frame = dedupe_latest(artifact_frame)

    print_facts_inventory(facts_key_inventory(artifact_frame))
    artifact_frame, stripped = strip_ground_truth(artifact_frame)
    artifact_frame, moved_records, scrubbed = scrub_simulator_text(artifact_frame)
    answer_key = pd.concat([answer_key, moved_records.drop(columns=["source_category"])], ignore_index=True)

    # From here on each artifact is a plain dict, so the day rules read row by row.
    artifacts = frame_records(artifact_frame)
    for row in artifacts:
        row["day"] = int(row["day"])
        row["date_value"] = row_date(row["date"])  # working field, not written

    # 1. Tags allowlist.
    tag_report = tag_inventory(artifacts)
    print_tag_report(tag_report)
    filter_tags(artifacts)

    # 2. Calendar from trustworthy rows. 3. Remap wrong days. 4. Infer the undated rows.
    calendar = build_calendar(artifacts)
    remap = remap_days(artifacts, CalendarIndex(calendar))
    inference = infer_days(artifacts)
    print_inference_table(inference)

    # 5. Sort by (day, timestamp), dayUnknown last.
    artifacts = sort_artifacts(artifacts)
    for row in artifacts:
        del row["date_value"]
    answer_key = answer_key.sort_values(["timestamp_utc", "doc_id"], na_position="last", kind="stable")

    print("\nWriting:")
    write_jsonl(artifacts, DATA_DIR / "artifacts.jsonl")
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

    write_stats(df, artifacts, tag_report, inference, stripped, calendar, remap, scrubbed, DATA_DIR / "stats.md")
    print_departures(people)
    self_check()


if __name__ == "__main__":
    main()
