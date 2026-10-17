"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "keystone.adminToken";

/**
 * The admin token for endpoints behind the API's AdminTokenGuard (replay, approve,
 * reject). Only needed when the API sets ADMIN_TOKEN; kept for this browser tab only
 * (sessionStorage), never in a URL. `needed` turns true after a 401, to show the field.
 */
export function useAdminToken() {
  const [token, setTokenState] = useState("");
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) setTokenState(saved);
    } catch {
      // Storage can be blocked; the field still works for this page view.
    }
  }, []);

  const setToken = useCallback((value: string) => {
    setTokenState(value);
    try {
      sessionStorage.setItem(KEY, value);
    } catch {
      // See above.
    }
  }, []);

  return { token, setToken, needed, setNeeded };
}
