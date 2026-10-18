"use client";

import { type FormEvent, type KeyboardEvent, type RefObject, useImperativeHandle, useLayoutEffect, useMemo, useState } from "react";
import { ArrowUp, MessageSquarePlus, Server, Square, Users } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SLASH_MENU_ID, SlashMenu, type SlashMenuItem } from "./slash-menu";
import {
  type DirectoryEntry,
  type DirectoryKind,
  matchCommands,
  matchEntries,
  readSlash,
  replaceRange,
} from "./slash-commands";

/** Lets the page fill the box, e.g. with a template whose gap opens the /people or /systems list. */
export interface ComposerHandle {
  /** Puts the text in the box and the caret at `caret` (default: the end), opening any slash menu there. */
  fill: (text: string, caret?: number) => void;
}

interface ComposerProps {
  /** The question being written; the page owns it, so a template can fill it in. */
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onAsk: (question: string) => void;
  onStop: () => void;
  /** Shown only once there is a chat on screen to leave. */
  onNewChat?: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  handle?: RefObject<ComposerHandle | null>;
}

/** The box grows with its text up to this many lines, then scrolls. */
const MAX_LINES = 8;

const COMMAND_ICONS: Record<DirectoryKind, typeof Users> = { people: Users, systems: Server };

/** "Engineering_Mobile" -> "Engineering · Mobile". */
const deptName = (dept: string | null) => (dept ? dept.replaceAll("_", " · ") : null);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * The question box (Intake's composer): Enter sends, Shift+Enter adds a line, Stop ends
 * a running answer, and "New chat" files the current chat under the previous ones.
 * Typing "/" opens a menu: /people mentions someone working at Apex, /systems a system.
 */
export function Composer({ value, onChange, busy, onAsk, onStop, onNewChat, inputRef, handle }: ComposerProps) {
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  // Esc closes the menu for the command it was open for, until another one starts.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // The directories behind /people and /systems: everyone still at the company, every system.
  const people = useApi((signal) => api.people(signal), []);
  const systems = useApi((signal) => api.busFactor("apex", signal), []);
  const directories = useMemo<Record<DirectoryKind, DirectoryEntry[] | null>>(
    () => ({
      people:
        people.data
          ?.filter((person) => person.active)
          .map((person) => ({ name: person.name, detail: deptName(person.dept) }))
          .sort((a, b) => a.name.localeCompare(b.name)) ?? null,
      systems:
        systems.data
          ?.map((row) => ({ name: row.system, detail: row.experts === 0 ? "no expert" : `${row.experts} expert${row.experts === 1 ? "" : "s"}` }))
          .sort((a, b) => a.name.localeCompare(b.name)) ?? null,
    }),
    [people.data, systems.data],
  );

  const slash = readSlash(value, caret);
  const menuOpen = slash !== null && slash.start !== dismissedAt;

  const menu = (() => {
    if (!slash) return null;
    if (slash.kind === "command") {
      const commands = matchCommands(slash.query);
      return {
        title: "Commands",
        emptyText: "No command starts with that. Try /people or /systems.",
        items: commands.map<SlashMenuItem>((command) => {
          const Icon = COMMAND_ICONS[command.name];
          return { key: command.name, icon: <Icon className="size-3.5" />, label: <span className="code-id">/{command.name}</span>, detail: command.description };
        }),
        pick: (index: number) => `/${commands[index].name} `,
      };
    }
    const directory = slash.directory;
    const state = directory === "people" ? people : systems;
    const entries = matchEntries(directories[directory] ?? [], slash.query);
    const Icon = COMMAND_ICONS[directory];
    return {
      title: directory === "people" ? `People at Apex · ${directories.people?.length ?? "…"}` : `Systems · ${directories.systems?.length ?? "…"}`,
      emptyText: state.error ? `Could not load the list: ${state.error}` : state.loading ? "Loading…" : "No match. Keep typing, or press Esc.",
      items: entries.map<SlashMenuItem>((entry) => ({
        key: entry.name,
        icon: directory === "people" ? initials(entry.name) : <Icon className="size-3.5" />,
        label: entry.name,
        detail: entry.detail,
      })),
      pick: (index: number) => `${entries[index].name} `,
    };
  })();

  const items = menuOpen && menu ? menu.items : [];
  const active = Math.min(highlighted, Math.max(items.length - 1, 0));

  // Grow with the text, up to MAX_LINES.
  useLayoutEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    const style = window.getComputedStyle(box);
    const line = parseFloat(style.lineHeight) || 24;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    box.style.height = `${Math.min(box.scrollHeight, Math.ceil(line * MAX_LINES + padding))}px`;
  }, [value, inputRef]);

  const moveCaret = (position: number) => {
    setCaret(position);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(position, position));
  };

  useImperativeHandle(handle, () => ({
    fill: (text, at = text.length) => {
      onChange(text);
      setDismissedAt(null);
      setHighlighted(0);
      inputRef.current?.focus();
      moveCaret(at);
    },
  }));

  const pick = (index: number) => {
    if (!slash || !menu || !menu.items[index]) return;
    let insert = menu.pick(index);
    // A name picked inside a sentence ("if Jax leaves?") needs no space of its own before a space or a mark.
    if (slash.kind === "entry" && /^[\s?!.,;:)]/.test(value.slice(slash.end))) insert = insert.trimEnd();
    const next = replaceRange(value, slash.start, slash.end, insert);
    onChange(next.text);
    setHighlighted(0);
    moveCaret(next.caret);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const question = value.trim();
    if (!question || busy) return;
    onAsk(question);
    onChange("");
    setCaret(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (menuOpen && slash) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedAt(slash.start);
        return;
      }
      if (items.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setHighlighted((active + step + items.length) % items.length);
          return;
        }
        if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
          event.preventDefault();
          pick(active);
          return;
        }
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const syncCaret = (box: HTMLTextAreaElement) => {
    setCaret(box.selectionStart);
    if (dismissedAt !== null && !readSlash(box.value, box.selectionStart)) setDismissedAt(null);
  };

  const canSend = value.trim().length > 0;

  return (
    <form onSubmit={submit} className="relative">
      {menuOpen && menu && (
        <SlashMenu title={menu.title} items={items} highlighted={active} emptyText={menu.emptyText} onPick={pick} onHighlight={setHighlighted} />
      )}
      <div className="rounded-2xl border border-foreground/10 bg-card shadow-raised transition-[border-color,box-shadow] duration-200 focus-within:border-foreground/25 focus-within:ring-4 focus-within:ring-ring/10">
        <label htmlFor="question" className="sr-only">
          Question
        </label>
        <textarea
          id="question"
          ref={inputRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setHighlighted(0);
            syncCaret(event.target);
          }}
          onSelect={(event) => syncCaret(event.currentTarget)}
          onKeyDown={onKeyDown}
          onBlur={() => setDismissedAt(slash?.start ?? null)}
          onFocus={() => setDismissedAt(null)}
          placeholder="Ask about people, systems or decisions. Type / to mention someone."
          rows={1}
          maxLength={2000}
          role="combobox"
          aria-controls={SLASH_MENU_ID}
          aria-expanded={menuOpen}
          aria-autocomplete="list"
          className="block min-h-14 w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed placeholder:text-faint focus:outline-none focus-visible:outline-none"
        />
        <div className="flex items-center gap-2 px-3 pb-3">
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              // Starts a command at the caret, with a space first when it would touch a word.
              const box = inputRef.current;
              const at = box?.selectionStart ?? value.length;
              const insert = at > 0 && !/\s/.test(value[at - 1]) ? " /" : "/";
              const next = replaceRange(value, at, box?.selectionEnd ?? at, insert);
              onChange(next.text);
              setDismissedAt(null);
              box?.focus();
              moveCaret(next.caret);
            }}
            aria-label="Mention a person or system"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <Users className="size-3.5" />
            <span className="hidden sm:inline">Mention</span>
          </button>
          {onNewChat && (
            <button
              type="button"
              onClick={onNewChat}
              // Leaving mid-answer would hide an answer that is still arriving.
              disabled={busy}
              aria-label="Start a new chat"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <MessageSquarePlus className="size-3.5" />
              <span className="hidden sm:inline">New chat</span>
            </button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[11px] text-muted-foreground md:inline">
              <kbd className="kbd">Enter</kbd> to send · <kbd className="kbd">Shift</kbd> <kbd className="kbd">Enter</kbd> for a new line
            </span>
            {busy ? (
              <button type="button" onClick={onStop} aria-label="Stop" className="flex size-9 items-center justify-center rounded-full bg-foreground/10 transition-colors hover:bg-foreground/15">
                <Square className="size-3" fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Ask"
                className={cn(
                  "flex size-9 items-center justify-center rounded-full transition-all duration-300 ease-spring active:scale-90",
                  canSend ? "scale-100 bg-primary text-primary-foreground shadow-raised hover:bg-primary-hover" : "scale-95 bg-foreground/[0.07] text-faint",
                )}
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
