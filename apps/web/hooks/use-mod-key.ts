"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘" on Apple devices, "Ctrl" elsewhere, for shortcut hints. The server render assumes a Mac. */
export function useModKey(): string {
  return useSyncExternalStore(noop, () => (isMac() ? "⌘" : "Ctrl"), () => "⌘");
}
