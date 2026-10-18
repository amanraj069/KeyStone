"use client";

import "@theme-toggles/react/styles/classic.css";
import { Classic } from "@theme-toggles/react";
import type { MouseEvent } from "react";
import { applyTheme, useTheme } from "@/contexts/theme-context";

/** How long the new theme takes to grow out of the toggle. */
const REVEAL_MS = 520;

export default function ThemeToggle() {
  const { theme, selectTheme } = useTheme();

  // v5 of @theme-toggles/react uses Tailwind's dark: variant for state.
  // The toggle animates based on the `dark` class on <html>, which our
  // ThemeContext manages. On click, where the browser supports view
  // transitions, the new theme spreads from the toggle as a circle.
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const next = theme === "dark" ? "light" : "dark";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced) {
      selectTheme(next);
      return;
    }
    const { clientX: x, clientY: y } = event;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(() => {
      applyTheme(next);
      selectTheme(next);
    });
    void transition.ready.then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: REVEAL_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::view-transition-new(root)" },
      ),
    );
  };

  return (
    <div className="flex items-center" suppressHydrationWarning>
      <Classic duration={750} onClick={onClick} className="text-foreground cursor-pointer" style={{ fontSize: "1.25rem" }} />
    </div>
  );
}
