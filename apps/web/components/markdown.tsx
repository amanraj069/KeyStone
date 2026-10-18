import type { ComponentPropsWithoutRef, ElementType } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type Tag = "h1" | "h2" | "h3" | "h4" | "p" | "ul" | "ol" | "li" | "strong" | "a" | "blockquote" | "code" | "pre" | "table" | "th" | "td";

/** One Markdown element with the app's classes; react-markdown's syntax-tree `node` never reaches the DOM. */
function styled<T extends Tag>(tag: T, className: string, extra?: ComponentPropsWithoutRef<T>) {
  function Element({ node, ...props }: ComponentPropsWithoutRef<T> & ExtraProps) {
    void node;
    const Component = tag as ElementType;
    return <Component className={className} {...extra} {...props} />;
  }
  return Element;
}

/** Each Markdown element styled with the app's tokens (there is no typography plugin). Raw HTML in the source stays escaped. */
const ELEMENTS: Components = {
  h1: styled("h1", "mt-6 mb-2 text-lg font-semibold tracking-tight"),
  h2: styled("h2", "mt-6 mb-2 text-base font-semibold tracking-tight"),
  h3: styled("h3", "mt-5 mb-1.5 text-sm font-semibold"),
  h4: styled("h4", "mt-4 mb-1 text-sm font-semibold text-muted-foreground"),
  p: styled("p", "my-2.5"),
  ul: styled("ul", "my-2.5 list-disc space-y-1 pl-5 marker:text-faint"),
  ol: styled("ol", "my-2.5 list-decimal space-y-1 pl-5 marker:text-faint"),
  li: styled("li", "pl-1"),
  strong: styled("strong", "font-semibold text-foreground"),
  a: styled("a", "font-medium text-foreground underline underline-offset-2 hover:text-signal", { target: "_blank", rel: "noopener noreferrer" }),
  blockquote: styled("blockquote", "my-3 border-l-2 border-foreground/15 pl-3 text-muted-foreground"),
  hr: () => <hr className="my-5 border-border" />,
  code: styled("code", "rounded bg-foreground/5 px-1 py-0.5 font-mono text-[0.85em]"),
  pre: styled("pre", "my-3 overflow-x-auto rounded-lg border border-foreground/10 bg-muted p-3 text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0"),
  table: styled("table", "my-3 block w-full overflow-x-auto border-collapse text-xs"),
  th: styled("th", "border border-foreground/10 bg-muted px-2 py-1.5 text-left font-semibold"),
  td: styled("td", "border border-foreground/10 px-2 py-1.5 align-top"),
};

/** Renders Markdown, with GitHub tables and lists, and single line breaks kept (as in Slack or Jira text). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("min-w-0 break-words [&>:first-child]:mt-0 [&>:last-child]:mb-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={ELEMENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
