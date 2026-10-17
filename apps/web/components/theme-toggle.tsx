"use client";

import "@theme-toggles/react/styles/classic.css";
import { Classic } from "@theme-toggles/react";
import { useTheme } from "@/contexts/theme-context";

export default function ThemeToggle() {
  const { toggleTheme } = useTheme();

  // v5 of @theme-toggles/react uses Tailwind's dark: variant for state.
  // The toggle animates based on the `dark` class on <html>, which our
  // ThemeContext manages. We just need to fire the toggle on click.
  return (
    <div className="flex items-center" suppressHydrationWarning>
      <Classic
        duration={750}
        onClick={toggleTheme}
        className="text-foreground cursor-pointer"
        style={{ fontSize: "1.25rem" }}
      />
    </div>
  );
}
