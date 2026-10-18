"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { ArtifactSheet } from "@/components/artifact-sheet";
import { Composer, type ComposerHandle } from "@/components/ask/composer";
import { DeletedToast } from "@/components/ask/deleted-toast";
import { Suggestions, type Template } from "@/components/ask/suggestions";
import { TurnView } from "@/components/ask/turn-view";
import { EARLIER_PAGE_SIZE, useAsk } from "@/hooks/use-ask";
import { toCanvasGraph } from "@/lib/graph";
import { cn } from "@/lib/utils";

/** The chat column: the thread and the composer share it, so they line up. */
const COLUMN = "mx-auto w-full max-w-6xl";
/** Scrolling to within this many pixels of the top opens the next earlier exchanges. */
const LOAD_EARLIER_AT_PX = 120;
/** How long "No history" stays under the button. */
const NO_HISTORY_NOTE_MS = 2000;
/** While the "Load previous chats" button scrolls the thread to the top, passing the top loads nothing more. */
const AUTO_LOAD_PAUSE_MS = 900;

/**
 * Ask: a full-height chat, laid out like Intake's assistant. Each answer carries the
 * graph the agent walked; tool results draw into it as they stream, the finished
 * path is highlighted, and a citation singles out that artifact. Chats are saved in
 * this browser: "New chat" starts another, and earlier exchanges open above it five
 * at a time, from "Load previous chats" and then by scrolling to the top.
 */
export default function AskPage() {
  const {
    turns,
    ask,
    stop,
    rate,
    busy,
    loaded,
    chatId,
    earlierHidden,
    showingPreviousChats,
    loadEarlier,
    startNewChat,
    deleteMessage,
    deletedMessage,
    undoDelete,
    dismissDeleted,
  } = useAsk();
  const [draft, setDraft] = useState("");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [citation, setCitation] = useState<string | null>(null);
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [noHistoryNote, setNoHistoryNote] = useState(false);
  /** Set just before earlier exchanges are added above, so the view can stay where it was. */
  const keepPlace = useRef<{ height: number; top: number } | null>(null);
  const autoLoadPausedUntil = useRef(0);

  // The newest question is the one whose graph is drawn.
  const latestId = turns.at(-1)?.id ?? null;
  useEffect(() => {
    setActiveTurnId(latestId);
    setCitation(null);
  }, [latestId]);

  // Keep the newest text in view while it streams. A new newest turn jumps there at once,
  // so the scroll never passes the top, where it would load earlier exchanges.
  const latest = turns.at(-1);
  const lastScrolledTo = useRef<string | null>(null);
  useEffect(() => {
    const jump = lastScrolledTo.current !== latestId;
    lastScrolledTo.current = latestId;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: jump ? "auto" : "smooth" });
  }, [latestId, latest?.answer, latest?.steps.length, latest?.paths.length]);

  // Earlier exchanges were added above: move down by their height, so nothing on screen moves.
  useLayoutEffect(() => {
    const box = scroller.current;
    const place = keepPlace.current;
    if (!box || !place) return;
    keepPlace.current = null;
    box.scrollTop = place.top + (box.scrollHeight - place.height);
  }, [turns.length]);

  const loadEarlierInPlace = () => {
    const box = scroller.current;
    if (box && turns.length > 0) keepPlace.current = { height: box.scrollHeight, top: box.scrollTop };
    loadEarlier();
  };

  /** Near the top, the next five open. Called on scroll, and on an upward wheel, which still fires at the very top. */
  const loadEarlierNearTop = () => {
    const box = scroller.current;
    if (!box || keepPlace.current || earlierHidden === 0 || turns.length === 0) return;
    if (performance.now() < autoLoadPausedUntil.current) return;
    if (box.scrollTop < LOAD_EARLIER_AT_PX) loadEarlierInPlace();
  };

  /** From "Load previous chats": open the newest five and bring them into view. */
  const openPreviousChats = () => {
    loadEarlier();
    // With this chat empty, the newest earlier exchange lands by the composer (the jump above).
    if (turns.length > 0) {
      autoLoadPausedUntil.current = performance.now() + AUTO_LOAD_PAUSE_MS;
      requestAnimationFrame(() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" }));
    }
  };

  /** A template goes into the box with "/people" or "/systems" in its gap, which opens that list there. */
  const fillTemplate = ({ before, slot, after }: Template) => {
    const gap = `${before}/${slot} `;
    composer.current?.fill(gap + after, gap.length);
  };

  // "No history" closes by itself.
  useEffect(() => {
    if (!noHistoryNote) return;
    const timer = setTimeout(() => setNoHistoryNote(false), NO_HISTORY_NOTE_MS);
    return () => clearTimeout(timer);
  }, [noHistoryNote]);

  const newChat = () => {
    startNewChat();
    input.current?.focus();
  };

  const onCite = (turnId: string, id: string) => {
    // A colleague's note is not a document: its text is the source's title, there is nothing to open.
    if (id.startsWith("NOTE-")) return;
    const target = turns.find((t) => t.id === turnId);
    const inGraph = target ? toCanvasGraph(target.paths).nodes.some((n) => n.artifactId === id) : false;
    setActiveTurnId(turnId);
    if (!inGraph) {
      // Not on any tool's graph (e.g. found by search): open it instead.
      setCitation(null);
      setOpenArtifact(id);
      return;
    }
    setCitation((current) => (current === id && turnId === activeTurnId ? null : id));
  };

  const isEmptyChat = turns.length === 0;
  // Always offered (Intake's button), until earlier chats are open; with none saved it says so.
  const showPreviousChatsButton = loaded && !showingPreviousChats;

  return (
    // Exactly the height under the top bar (the phone header is the same 3.5rem).
    <div className="relative flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col" aria-label="Ask">
      {showPreviousChatsButton && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 px-4 sm:top-6 sm:px-6 lg:px-8">
          {/* The composer's column, so the button ends at the box's right edge. */}
          <div className={cn(COLUMN, "flex flex-col items-end gap-2")}>
            <button
              type="button"
              onClick={() => (earlierHidden > 0 ? openPreviousChats() : setNoHistoryNote(true))}
              className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-foreground/10 bg-card/90 px-4 py-2 text-xs font-semibold shadow-card backdrop-blur-xs transition-all duration-150 hover:border-foreground/25 hover:bg-card sm:px-5 sm:py-2.5 sm:text-sm"
            >
              <History className="size-4 text-muted-foreground" />
              Load previous chats
            </button>
            {noHistoryNote && (
              <p role="status" className="rounded-xl border border-foreground/10 bg-popover px-3.5 py-2 text-xs font-medium text-muted-foreground shadow-overlay">
                No history
              </p>
            )}
          </div>
        </div>
      )}

      <div
        ref={scroller}
        onScroll={loadEarlierNearTop}
        onWheel={(event) => event.deltaY < 0 && loadEarlierNearTop()}
        // A container, so an answer's avatar can hang outside the column only where it fits.
        className="@container flex min-h-0 flex-1 flex-col overflow-y-auto px-4 sm:px-6 lg:px-8">
        {isEmptyChat ? (
          <div className={`${COLUMN} flex flex-1 flex-col`}>
            <Suggestions onPick={fillTemplate} />
          </div>
        ) : (
          // Room at the top for the floating "Load previous chats" button.
          <div className={cn(COLUMN, "space-y-8 pb-10", showPreviousChatsButton ? "pt-20" : "pt-8")}>
            {showingPreviousChats && <EarlierIndicator hidden={earlierHidden} onLoad={loadEarlierInPlace} />}
            {turns.map((t, index) => (
              <Fragment key={t.id}>
                {showingPreviousChats && t.chatId !== turns[index - 1]?.chatId && (
                  <ChatDivider askedAt={t.askedAt} current={t.chatId === chatId} />
                )}
                <TurnView
                  turn={t}
                  active={t.id === activeTurnId}
                  activeCitation={citation}
                  onCite={onCite}
                  onSelect={(id) => {
                    setActiveTurnId(id);
                    setCitation(null);
                  }}
                  onClearCitation={() => setCitation(null)}
                  onDelete={deleteMessage}
                  onRate={rate}
                />
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {/* The composer floats over a fade, so the thread scrolls away under it. */}
      <div className="relative shrink-0 px-4 pb-4 sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" />
        <div className={COLUMN}>
          {deletedMessage && <DeletedToast key={`${deletedMessage.turnId}-${deletedMessage.message}`} onUndo={undoDelete} onDismiss={dismissDeleted} />}
          <Composer
            value={draft}
            onChange={setDraft}
            busy={busy}
            onAsk={ask}
            onStop={stop}
            onNewChat={isEmptyChat && !showingPreviousChats ? undefined : newChat}
            inputRef={input}
            handle={composer}
          />
          <p className="mt-2 text-center text-[11px] text-faint">Answers come from the company graph. Every claim cites the document it came from.</p>
        </div>
      </div>
      <ArtifactSheet artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />
    </div>
  );
}

/**
 * The top of the thread once earlier chats are open: a button for the next five (also
 * reached by scrolling up, but a short thread cannot scroll), or the start of history.
 */
function EarlierIndicator({ hidden, onLoad }: { hidden: number; onLoad: () => void }) {
  if (hidden === 0) return <p className="text-center text-xs text-faint">Start of the chats saved in this browser</p>;
  return (
    <button
      type="button"
      onClick={onLoad}
      className="mx-auto flex items-center gap-2 rounded-full border border-foreground/10 px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
    >
      <History className="size-3.5" />
      Scroll up or click for {Math.min(EARLIER_PAGE_SIZE, hidden)} more
      <span className="text-faint tabular-nums">· {hidden} saved</span>
    </button>
  );
}

/** Marks where one chat ends and the next begins, with when it started. */
function ChatDivider({ askedAt, current }: { askedAt: string; current: boolean }) {
  const when = new Date(askedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex items-center gap-3 text-[11px] font-semibold text-faint" role="separator">
      <span className="h-px flex-1 bg-border" />
      {current ? "This chat" : `Chat from ${when}`}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
