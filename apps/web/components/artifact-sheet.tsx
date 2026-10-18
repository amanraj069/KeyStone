"use client";

import { Markdown } from "@/components/markdown";
import { SHEET_PANEL_WIDTH, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ArtifactSheetProps {
  /** The artifact to show; null closes the sheet. */
  artifactId: string | null;
  onClose: () => void;
}

/** Side sheet with an artifact's title, type, day, people and the start of its body, rendered as Markdown. */
export function ArtifactSheet({ artifactId, onClose }: ArtifactSheetProps) {
  const { data, error, loading } = useApi(artifactId ? (signal) => api.artifact(artifactId, signal) : null, [artifactId]);
  const shown = data && data.id === artifactId ? data : null;

  return (
    <Sheet open={artifactId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className={cn(SHEET_PANEL_WIDTH, "gap-0")}>
        <SheetHeader className="gap-2 border-b px-5 pt-6 pr-12 pb-5 sm:px-6 sm:pr-12">
          <p className="code-id break-all text-muted-foreground">{artifactId}</p>
          <SheetTitle className="text-lg leading-snug font-semibold tracking-tight break-words sm:text-xl">
            {shown?.title ?? (loading ? <Skeleton className="h-6 w-3/4" /> : "Untitled")}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {shown?.label && <Meta name="Type" value={shown.type ? `${shown.label} · ${shown.type}` : shown.label} />}
              {shown?.day != null && <Meta name="Day" value={String(shown.day)} />}
              {shown && shown.people.length > 0 && <Meta name="People" value={shown.people.join(", ")} />}
            </div>
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {error && <p className="text-sm text-muted-foreground">Could not load this artifact: {error}</p>}
          {loading && !shown && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          )}
          {shown &&
            (shown.excerpt ? (
              <Body text={shown.excerpt} people={shown.people} />
            ) : (
              <p className="text-sm text-muted-foreground">The body of this artifact is not in the text store.</p>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A line that opens a message in a thread: "Kaitlyn: I'm stuck on…". */
const SPEAKER_LINE = /^([^:\n]{1,40}):\s+(.*)$/;

interface Message {
  speaker: string;
  text: string;
}

/**
 * The body read as a conversation (Slack threads, DMs), or null when it is not one.
 * A speaker must be one of the artifact's people, so a "Goals: …" line in a page is
 * not taken for one. Lines that do not open a message continue the one before.
 */
function toMessages(text: string, people: readonly string[]): Message[] | null {
  const names = new Set(people);
  const messages: Message[] = [];
  for (const line of text.split("\n")) {
    const match = SPEAKER_LINE.exec(line);
    if (match && names.has(match[1].trim())) messages.push({ speaker: match[1].trim(), text: match[2] });
    else if (messages.length > 0) messages[messages.length - 1].text += `\n${line}`;
    else if (line.trim()) return null;
  }
  return messages.length >= 2 ? messages : null;
}

/** The body: a conversation with each speaker set apart, or else Markdown. */
function Body({ text, people }: { text: string; people: readonly string[] }) {
  const messages = toMessages(text, people);
  if (!messages) return <Markdown text={text} className="text-[0.9rem] leading-relaxed text-foreground/90" />;
  return (
    <ol>
      {messages.map((message, index) => {
        // A new speaker starts a new group, with room above it; the same one carries on below.
        const sameSpeaker = message.speaker === messages[index - 1]?.speaker;
        return (
          <li key={index} className={cn("flex gap-3", index > 0 && (sameSpeaker ? "mt-1.5" : "mt-5"))}>
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-[11px] font-semibold text-muted-foreground",
                sameSpeaker && "invisible",
              )}
            >
              {message.speaker.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              {!sameSpeaker && <p className="mb-0.5 text-xs font-semibold">{message.speaker}</p>}
              <Markdown text={message.text.trim()} className="text-[0.9rem] leading-relaxed text-foreground/90" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Meta({ name, value }: { name: string; value: string }) {
  return (
    <span>
      <span className="text-faint">{name}</span> <span className="text-foreground/80">{value}</span>
    </span>
  );
}
