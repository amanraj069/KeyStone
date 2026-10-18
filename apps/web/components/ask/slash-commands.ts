/** The directories a slash command can pick from. */
export type DirectoryKind = "people" | "systems";

export interface SlashCommand {
  name: DirectoryKind;
  description: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "people", description: "Mention someone working at Apex" },
  { name: "systems", description: "Mention a system from the company graph" },
];

/** One row a directory offers: what gets inserted, and a short note beside it. */
export interface DirectoryEntry {
  name: string;
  detail: string | null;
}

/**
 * What is being typed just before the caret: "/peo" picks a command, "/people ad"
 * picks from that command's directory. `start` and `end` are the text to replace.
 */
export type SlashState =
  | { kind: "command"; start: number; end: number; query: string }
  | { kind: "entry"; directory: DirectoryKind; start: number; end: number; query: string };

/** A slash only starts a command at the start of the text or after a space. */
const ENTRY_PATTERN = /(^|\s)\/(people|systems) ([^\n/]{0,40})$/;
const COMMAND_PATTERN = /(^|\s)\/([a-z]*)$/i;

export function readSlash(text: string, caret: number): SlashState | null {
  const before = text.slice(0, caret);
  const entry = ENTRY_PATTERN.exec(before);
  if (entry) {
    const start = entry.index + entry[1].length;
    return { kind: "entry", directory: entry[2] as DirectoryKind, start, end: caret, query: entry[3].trim().toLowerCase() };
  }
  const command = COMMAND_PATTERN.exec(before);
  if (command) {
    const start = command.index + command[1].length;
    return { kind: "command", start, end: caret, query: command[2].toLowerCase() };
  }
  return null;
}

export function matchCommands(query: string): SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(query));
}

/** Entries whose name (or note) contains the query; names that start with it come first. */
export function matchEntries(entries: readonly DirectoryEntry[], query: string): DirectoryEntry[] {
  if (!query) return [...entries];
  const hits = entries.filter((entry) => entry.name.toLowerCase().includes(query) || entry.detail?.toLowerCase().includes(query));
  const starts = (entry: DirectoryEntry) => (entry.name.toLowerCase().startsWith(query) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b));
}

/** The text with [start, end) replaced, and where the caret goes after the insert. */
export function replaceRange(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}
