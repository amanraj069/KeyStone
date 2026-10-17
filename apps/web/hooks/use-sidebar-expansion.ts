"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "keystone:sidebar-expanded";
const CHANGE_EVENT = "keystone:sidebar";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true; // storage blocked: the default (expanded) is fine
  }
}

/**
 * Whether the desktop sidebar shows labels or only its icon rail, remembered per
 * browser (as in Intake). Read through useSyncExternalStore, so the server render
 * (expanded) and the first client paint agree.
 */
export function useSidebarExpansion(): { expanded: boolean; toggle: () => void } {
  const expanded = useSyncExternalStore(subscribe, read, () => true);
  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(!read()));
    } catch {
      // A failed write only loses the preference.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return { expanded, toggle };
}
