import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ArtifactDetail } from '@keystone/shared';
import { APEX_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import { TEXT_STORE } from '../ingest/ingest.constants';
import type { TextStore } from '../ingest/text-store';
import {
  ARTIFACT_DETAIL,
  ARTIFACT_LINKS,
  ARTIFACT_PEOPLE,
  CAUSAL_PROXIMITY,
  CHECK_CAUSAL_LINK,
  CHECK_FOLLOW_UP,
  CHECK_INVOLVEMENT,
  EXISTING_ARTIFACT_IDS,
  FIND_ARTIFACTS,
  FIND_EVENT_CANDIDATES,
  WHAT_FOLLOWED,
} from './queries/artifacts.queries';
import { PERSON_EXISTS } from '../analytics/queries/analytics.queries';

/** The UI shows this much of an artifact's body. */
export const EXCERPT_CHARS = 1200;

/** The doc types artifacts can have (OrgForge doc_type, stored as Artifact.type). */
export const ARTIFACT_TYPES = [
  'jira', 'confluence', 'slack', 'pr', 'email', 'zoom_transcript', 'datadog_alert', 'zd_ticket', 'sf_opp', 'invoice', 'nps_survey',
] as const;

/** find(): default and largest number of artifacts returned. */
export const FIND_DEFAULT_LIMIT = 20;
export const FIND_MAX_LIMIT = 40;
/**
 * A text filter reads bodies from the TextStore (they are not in the graph), so it
 * needs the graph filters to narrow the candidates first: people, or a day range
 * of at most TEXT_SCAN_MAX_DAYS. At most TEXT_SCAN_MAX_CANDIDATES bodies are read.
 */
export const TEXT_SCAN_MAX_DAYS = 21;
export const TEXT_SCAN_MAX_CANDIDATES = 1500;
/** Characters of body shown on each side of a text match. */
const SNIPPET_RADIUS = 160;
/** what_followed(): default and largest window in days, and how many artifacts it returns. */
export const FOLLOW_DEFAULT_DAYS = 10;
export const FOLLOW_MAX_DAYS = 30;
const FOLLOW_LIMIT = 25;
/** get_artifact(): at most this many linked artifacts. */
const LINKS_LIMIT = 30;

/**
 * find_event(): candidates come from the day +- tolerance (default 2: Slack and email
 * timestamps can run a day or two after the date of the event); at most
 * EVENT_MAX_CANDIDATES are scored, the best EVENT_DEFAULT_LIMIT returned.
 */
export const EVENT_DEFAULT_TOLERANCE = 2;
export const EVENT_MAX_TOLERANCE = 5;
const EVENT_MAX_CANDIDATES = 400;
const EVENT_DEFAULT_LIMIT = 8;
/**
 * find_event() score weights: people involved count most, then title words, then words
 * in the text, each word weighted by how rare it is among the candidates (a word most
 * of them contain says nothing); a document type the description names adds a bonus;
 * each day away costs one.
 */
const SCORE_PER_PERSON = 3;
const SCORE_PER_TITLE_WORD = 2;
const SCORE_PER_TEXT_WORD = 1;
const SCORE_NAMED_TYPE = 2;
const MAX_TEXT_WORDS = 5;
/** Words that name a document type ("the customer email", "the Zendesk escalation"). */
const TYPE_WORDS: Readonly<Record<string, string>> = {
  email: 'email', emails: 'email', inbound: 'email',
  zendesk: 'zd_ticket',
  confluence: 'confluence',
  jira: 'jira',
  slack: 'slack', thread: 'slack', channel: 'slack',
  pr: 'pr', pull: 'pr',
  meeting: 'zoom_transcript', zoom: 'zoom_transcript',
  datadog: 'datadog_alert', alert: 'datadog_alert',
  salesforce: 'sf_opp', deal: 'sf_opp', deals: 'sf_opp',
};
/** Words that say nothing about which artifact is meant. */
const STOPWORDS = new Set(
  ('the and for with that this from was were did does would could have has had into onto then than when what which who whom whose ' +
    'about after before during their there they them its not any all also been being day days on by of to in at an as is it be or ' +
    'created opened sent involving event events still later earlier first').split(' '),
);

/** check_follow_up(): default and largest window in days. */
export const FOLLOW_UP_DEFAULT_DAYS = 15;
/**
 * The kinds of response check_follow_up can look for: doc types, plus a title word
 * where the kind is a sort of document rather than a type ("Postmortem: ..." tickets
 * and pages). Built from the corpus's own doc types and titles.
 */
export const FOLLOW_UP_KINDS = {
  postmortem: { types: ['confluence', 'jira'], title: 'postmortem' },
  ticket: { types: ['jira'], title: null },
  support_ticket: { types: ['zd_ticket'], title: null },
  page: { types: ['confluence'], title: null },
  email: { types: ['email'], title: null },
  thread: { types: ['slack'], title: null },
  meeting: { types: ['zoom_transcript'], title: null },
  pull_request: { types: ['pr'], title: null },
  alert: { types: ['datadog_alert'], title: null },
  deal: { types: ['sf_opp'], title: null },
  any: { types: [], title: null },
} as const satisfies Record<string, { types: readonly string[]; title: string | null }>;
export type FollowUpKind = keyof typeof FOLLOW_UP_KINDS;

/** check_causal_link(): an unlinked effect this many days after the cause, among the same people, is a "likely" tie. */
export const CAUSAL_PROXIMITY_DAYS = 5;

/** check_visibility(): how many runner-up candidates are shown next to the event it decided on. */
const VISIBILITY_RUNNERS_UP = 2;
/**
 * check_visibility(): description words that mark an event as broadcast rather than
 * private. An incident, outage or postmortem goes out on a company-wide incidents
 * channel and alerting, and a detected knowledge gap goes out as a digest; anyone with
 * ordinary system access could plausibly have seen one without being a named author,
 * reviewer or participant on the one document find_event happens to match. A private
 * document — a single PR review, a 1:1 email, one Confluence page someone wrote — is
 * not broadcast this way, so it still needs a direct or linked record of involvement.
 */
const BROADCAST_WORDS = ['incident', 'p1', 'p2', 'outage', 'postmortem', 'post-mortem', 'knowledge gap', 'knowledge-gap'];

/** Does an event description name a broadcast-kind event (see BROADCAST_WORDS)? */
export function looksBroadcast(description: string): boolean {
  const text = description.toLowerCase();
  return BROADCAST_WORDS.some((w) => text.includes(w));
}
export const FOLLOW_UP_KIND_NAMES = Object.keys(FOLLOW_UP_KINDS) as [FollowUpKind, ...FollowUpKind[]];

export interface ArtifactFilter {
  people?: string[];
  fromDay?: number | null;
  toDay?: number | null;
  types?: string[];
  titleContains?: string | null;
  textContains?: string | null;
  limit?: number;
}

export interface FoundArtifact {
  id: string;
  type: string | null;
  title: string | null;
  day: number | null;
  /** How many of the requested people are involved (0 when no people were given). */
  matched: number;
  people: { name: string; role: string }[];
  /** With a text filter: the body around the first match. */
  snippet?: string;
}

export interface LinkedArtifact {
  id: string;
  type: string | null;
  title: string | null;
  day: number | null;
  link: string;
  kind: string | null;
  direction: 'in' | 'out';
}

export interface ArtifactContext {
  id: string;
  type: string | null;
  title: string | null;
  day: number | null;
  people: { name: string; roles: string[]; day: number | null }[];
  links: LinkedArtifact[];
  excerpt: string | null;
}

export interface FollowedArtifact {
  id: string;
  type: string | null;
  title: string | null;
  day: number | null;
  linked: boolean;
  shared: string[];
}

/**
 * Reading artifacts: one artifact for the UI, and the agent's event tools, which
 * look artifacts up by day, people, type, title and links. Properties, people and
 * links come from the graph; body text from the TextStore.
 */
@Injectable()
export class ArtifactsService {
  constructor(
    private readonly graph: GraphService,
    @Inject(TEXT_STORE) private readonly textStore: TextStore,
  ) {}

  async detail(id: string, graphName = APEX_GRAPH): Promise<ArtifactDetail> {
    const [row] = await this.graph.roQuery<Omit<ArtifactDetail, 'excerpt'>>(graphName, ARTIFACT_DETAIL, { id });
    if (!row) throw new NotFoundException(`No artifact ${id}`);
    return { ...row, excerpt: await this.excerpt(id) };
  }

  /** Artifacts matching every given filter; artifacts involving more of the people first, then oldest first. */
  async find(filter: ArtifactFilter, graphName = APEX_GRAPH): Promise<{ artifacts: FoundArtifact[]; more: boolean }> {
    const people = filter.people ?? [];
    const fromDay = filter.fromDay ?? null;
    const toDay = filter.toDay ?? null;
    const title = filter.titleContains?.trim().toLowerCase() || null;
    const text = filter.textContains?.trim().toLowerCase() || null;
    const limit = Math.min(Math.max(filter.limit ?? FIND_DEFAULT_LIMIT, 1), FIND_MAX_LIMIT);
    if (people.length === 0 && fromDay === null && toDay === null && !title && !text && (filter.types ?? []).length === 0) {
      throw new BadRequestException('Give at least one filter: people, a day range, types, titleContains or textContains');
    }
    if (text && people.length === 0 && (fromDay === null || toDay === null || toDay - fromDay > TEXT_SCAN_MAX_DAYS)) {
      throw new BadRequestException(`textContains needs people, or a day range (fromDay and toDay) of at most ${TEXT_SCAN_MAX_DAYS} days`);
    }

    const rows = await this.graph.roQuery<FoundArtifact>(graphName, FIND_ARTIFACTS, {
      people,
      fromDay,
      toDay,
      types: filter.types ?? [],
      title,
      // One extra row tells whether there are more; a text filter needs every candidate.
      limit: text ? TEXT_SCAN_MAX_CANDIDATES : limit + 1,
    });
    if (!text) return { artifacts: rows.slice(0, limit), more: rows.length > limit };

    // The body is not in the graph: the graph narrowed the candidates, the TextStore has the words.
    const bodies = await this.textStore.getMany('artifacts', rows.map((r) => r.id));
    const hits = rows.flatMap((row) => {
      const body = bodies.get(row.id) ?? '';
      const at = body.toLowerCase().indexOf(text);
      if (at >= 0) return [{ ...row, snippet: snippet(body, at, text.length) }];
      return (row.title ?? '').toLowerCase().includes(text) ? [row] : [];
    });
    return { artifacts: hits.slice(0, limit), more: hits.length > limit };
  }

  /** One artifact with everyone involved (and how), its linked artifacts and the start of its body. */
  async context(id: string, graphName = APEX_GRAPH): Promise<ArtifactContext> {
    const [row] = await this.graph.roQuery<{ id: string; type: string | null; title: string | null; day: number | null }>(graphName, ARTIFACT_DETAIL, { id });
    if (!row) throw new NotFoundException(`No artifact ${id}`);
    const [people, links, excerpt] = await Promise.all([
      this.graph.roQuery<ArtifactContext['people'][number]>(graphName, ARTIFACT_PEOPLE, { id }),
      this.graph.roQuery<LinkedArtifact>(graphName, ARTIFACT_LINKS, { id, limit: LINKS_LIMIT }),
      this.excerpt(id),
    ]);
    return { id: row.id, type: row.type, title: row.title, day: row.day, people, links, excerpt };
  }

  /** Artifacts in the `days` after one artifact that are linked to it or involve its people. */
  async whatFollowed(
    id: string,
    options: { days?: number; types?: string[] } = {},
    graphName = APEX_GRAPH,
  ): Promise<{ source: { id: string; title: string | null; type: string | null; day: number }; days: number; types: string[]; followed: FollowedArtifact[] }> {
    const [source] = await this.graph.roQuery<{ id: string; type: string | null; title: string | null; day: number | null }>(graphName, ARTIFACT_DETAIL, { id });
    if (!source) throw new NotFoundException(`No artifact ${id}`);
    if (source.day === null) throw new BadRequestException(`Artifact ${id} has no day, so nothing can be said to follow it`);
    const days = Math.min(Math.max(options.days ?? FOLLOW_DEFAULT_DAYS, 0), FOLLOW_MAX_DAYS);
    const types = options.types ?? [];
    const followed = await this.graph.roQuery<FollowedArtifact>(graphName, WHAT_FOLLOWED, { id, days, types, limit: FOLLOW_LIMIT });
    return { source: { id: source.id, title: source.title, type: source.type, day: source.day }, days, types, followed };
  }

  /**
   * Candidates for an event given its day, the people in it and a short description:
   * every artifact within `tolerance` days, scored by people involved, description
   * words in the title and in the text, and distance from the day. Best first.
   */
  async findEvent(
    input: { day: number; people?: string[]; description?: string; types?: string[]; tolerance?: number; limit?: number },
    graphName = APEX_GRAPH,
  ): Promise<{ day: number; fromDay: number; toDay: number; words: string[]; candidates: (FoundArtifact & { score: number; titleWords: string[]; textWords: string[] })[] }> {
    const tolerance = Math.min(Math.max(input.tolerance ?? EVENT_DEFAULT_TOLERANCE, 0), EVENT_MAX_TOLERANCE);
    const people = input.people ?? [];
    const fromDay = input.day - tolerance;
    const toDay = input.day + tolerance;
    const words = descriptionWords(input.description ?? '', people);
    const rows = await this.graph.roQuery<FoundArtifact>(graphName, FIND_EVENT_CANDIDATES, {
      fromDay,
      toDay,
      people,
      types: input.types ?? [],
      limit: EVENT_MAX_CANDIDATES,
    });
    // The text is not in the graph: the graph narrowed the window, the TextStore has the words.
    const bodies = words.length > 0 ? await this.textStore.getMany('artifacts', rows.map((r) => r.id)) : new Map<string, string>();
    const docs = rows.map((row) => ({ row, title: (row.title ?? '').toLowerCase(), body: (bodies.get(row.id) ?? '').toLowerCase() }));
    const weight = rarity(words, docs.map((d) => `${d.title} ${d.body}`));
    const namedTypes = new Set(words.flatMap((w) => (TYPE_WORDS[w] ? [TYPE_WORDS[w]] : [])));
    const scored = docs.map(({ row, title, body }) => {
      const titleWords = words.filter((w) => title.includes(w));
      const textWords = words.filter((w) => !titleWords.includes(w) && body.includes(w)).slice(0, MAX_TEXT_WORDS);
      const sum = (list: string[]) => list.reduce((total, w) => total + (weight.get(w) ?? 0), 0);
      const score =
        SCORE_PER_PERSON * row.matched +
        SCORE_PER_TITLE_WORD * sum(titleWords) +
        SCORE_PER_TEXT_WORD * sum(textWords) +
        (row.type && namedTypes.has(row.type) ? SCORE_NAMED_TYPE : 0) -
        Math.abs((row.day ?? input.day) - input.day);
      return { ...row, score: Math.round(score * 100) / 100, titleWords, textWords };
    });
    scored.sort((a, b) => b.score - a.score || (a.day ?? 0) - (b.day ?? 0) || a.id.localeCompare(b.id));
    const limit = Math.min(Math.max(input.limit ?? EVENT_DEFAULT_LIMIT, 1), FIND_MAX_LIMIT);
    return { day: input.day, fromDay, toDay, words, candidates: scored.slice(0, limit) };
  }

  /** Did a response of `kind` follow an artifact within `days`? Only linked artifacts count. */
  async checkFollowUp(
    id: string,
    kind: FollowUpKind,
    days = FOLLOW_UP_DEFAULT_DAYS,
    graphName = APEX_GRAPH,
  ): Promise<{ source: { id: string; title: string | null; day: number }; kind: FollowUpKind; fromDay: number; toDay: number; followed: boolean; responses: { id: string; type: string | null; title: string | null; day: number | null; hops: number }[] }> {
    const [source] = await this.graph.roQuery<{ id: string; title: string | null; day: number | null }>(graphName, ARTIFACT_DETAIL, { id });
    if (!source) throw new NotFoundException(`No artifact ${id}`);
    if (source.day === null) throw new BadRequestException(`Artifact ${id} has no day, so nothing can be said to follow it`);
    const window = Math.min(Math.max(days, 0), FOLLOW_MAX_DAYS);
    const { types, title } = FOLLOW_UP_KINDS[kind];
    const responses = await this.graph.roQuery<{ id: string; type: string | null; title: string | null; day: number | null; hops: number }>(
      graphName,
      CHECK_FOLLOW_UP,
      { id, days: window, types: [...types], title },
    );
    return { source: { id: source.id, title: source.title, day: source.day }, kind, fromDay: source.day, toDay: source.day + window, followed: responses.length > 0, responses };
  }

  /** Was a person involved in these artifacts by a day: directly, or only through a linked artifact? */
  async checkInvolvement(
    person: string,
    ids: string[],
    asOfDay: number | null = null,
    graphName = APEX_GRAPH,
  ): Promise<{ person: string; asOfDay: number | null; involved: boolean; onlyViaLinked: boolean; artifacts: { id: string; title: string | null; day: number | null; roles: string[]; viaLinked: string[] }[]; unknownIds: string[] }> {
    const [who] = await this.graph.roQuery<{ name: string }>(graphName, PERSON_EXISTS, { person });
    if (!who) throw new NotFoundException(`No person named "${person}"`);
    const artifacts = await this.graph.roQuery<{ id: string; title: string | null; day: number | null; roles: string[]; viaLinked: string[] }>(
      graphName,
      CHECK_INVOLVEMENT,
      { person, ids, asOfDay },
    );
    const involved = artifacts.some((a) => a.roles.length > 0);
    return {
      person,
      asOfDay,
      involved,
      onlyViaLinked: !involved && artifacts.some((a) => a.viaLinked.length > 0),
      artifacts,
      unknownIds: ids.filter((id) => !artifacts.some((a) => a.id === id)),
    };
  }

  /**
   * Could a person have known about an event by a day? Finds the event WITHOUT that
   * person (they may not be part of it: searching with them would only find what they
   * touched), decides on the best candidate, and checks their involvement in it. When
   * there is no direct or linked involvement but the description names a broadcast-kind
   * event (BROADCAST_WORDS: an incident, outage, postmortem or detected knowledge gap),
   * the verdict is still could_have_known — those go out company-wide, not just to the
   * people recorded on the one matched document. A quoted title, when given, is looked
   * up first.
   */
  async checkVisibility(
    input: { person: string; day: number; description: string; title?: string; eventPeople?: string[]; types?: string[] },
    graphName = APEX_GRAPH,
  ): Promise<{
    person: string;
    day: number;
    verdict: 'could_have_known' | 'no_record_of_involvement' | 'event_not_found';
    event: { id: string; title: string | null; day: number | null } | null;
    roles: string[];
    viaLinked: string[];
    runnersUp: { id: string; title: string | null; day: number | null }[];
    /** could_have_known came from the event being a broadcast kind, not a direct or linked record. */
    broadcast: boolean;
  }> {
    const eventPeople = (input.eventPeople ?? []).filter((p) => p !== input.person);
    const byTitle = input.title
      ? (await this.find({ titleContains: input.title, toDay: input.day, types: input.types, limit: 1 + VISIBILITY_RUNNERS_UP }, graphName)).artifacts
      : [];
    const candidates =
      byTitle.length > 0
        ? byTitle
        : (await this.findEvent({ day: input.day, people: eventPeople, description: input.description, types: input.types, limit: 1 + VISIBILITY_RUNNERS_UP }, graphName))
            .candidates;
    const brief = (a: { id: string; title: string | null; day: number | null }) => ({ id: a.id, title: a.title, day: a.day });
    const [event, ...rest] = candidates;
    if (!event) {
      return { person: input.person, day: input.day, verdict: 'event_not_found', event: null, roles: [], viaLinked: [], runnersUp: [], broadcast: false };
    }
    const involvement = await this.checkInvolvement(input.person, [event.id], input.day, graphName);
    const [row] = involvement.artifacts;
    const broadcast = !involvement.involved && looksBroadcast(input.description);
    return {
      person: input.person,
      day: input.day,
      verdict: involvement.involved || broadcast ? 'could_have_known' : 'no_record_of_involvement',
      event: brief(event),
      roles: row?.roles ?? [],
      viaLinked: row?.viaLinked ?? [],
      runnersUp: rest.map(brief),
      broadcast,
    };
  }

  /**
   * Did the later event follow from the earlier one? verdict:
   *   linked       a chain of references / fixes (up to three) ties them
   *   likely       no link, but the later one came within CAUSAL_PROXIMITY_DAYS, among the same people
   *   no_evidence  neither
   */
  async checkCausalLink(
    causes: string[],
    effects: string[],
    graphName = APEX_GRAPH,
  ): Promise<{
    verdict: 'linked' | 'likely' | 'no_evidence';
    linked: boolean;
    links: { cause: string; effect: string; via: string[]; kinds: string[] }[];
    proximity: { cause: string; effect: string; daysApart: number; shared: string[] }[];
    checked: string[];
    unknownIds: string[];
  }> {
    const [links, proximity, existing] = await Promise.all([
      this.graph.roQuery<{ cause: string; effect: string; via: string[]; kinds: string[] }>(graphName, CHECK_CAUSAL_LINK, { causes, effects }),
      this.graph.roQuery<{ cause: string; effect: string; daysApart: number; shared: string[] }>(graphName, CAUSAL_PROXIMITY, {
        causes,
        effects,
        days: CAUSAL_PROXIMITY_DAYS,
      }),
      this.graph.roQuery<{ id: string }>(graphName, EXISTING_ARTIFACT_IDS, { ids: [...causes, ...effects] }),
    ]);
    const known = new Set(existing.map((r) => r.id));
    return {
      verdict: links.length > 0 ? 'linked' : proximity.length > 0 ? 'likely' : 'no_evidence',
      linked: links.length > 0,
      links,
      proximity,
      checked: [...causes, ...effects].filter((id) => known.has(id)),
      unknownIds: [...causes, ...effects].filter((id) => !known.has(id)),
    };
  }

  private async excerpt(id: string): Promise<string | null> {
    const body = await this.textStore.get('artifacts', id);
    return body === null ? null : body.length > EXCERPT_CHARS ? `${body.slice(0, EXCERPT_CHARS).trimEnd()}…` : body;
  }
}

/** The body around a match, with "…" where it was cut. */
export function snippet(body: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(body.length, at + length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${end < body.length ? '…' : ''}`;
}

/** The description's words worth matching: lower case, 3+ letters, no stopwords, numbers or the people's names. */
export function descriptionWords(description: string, people: readonly string[] = []): string[] {
  const names = new Set(people.map((p) => p.toLowerCase()));
  const words = description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w) && !names.has(w));
  return [...new Set(words)];
}

/**
 * How telling each word is among some texts, from 0 (every text has it) to 1 (only
 * one does): log((n + 1) / (df + 1)) / log(n + 1), the usual inverse document frequency,
 * scaled so a word weighs at most what an unweighted word did.
 */
export function rarity(words: readonly string[], texts: readonly string[]): Map<string, number> {
  const n = texts.length;
  const scale = Math.log(n + 1) || 1;
  return new Map(words.map((w) => [w, Math.log((n + 1) / (texts.filter((t) => t.includes(w)).length + 1)) / scale]));
}
