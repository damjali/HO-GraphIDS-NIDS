"use client";

import { useEffect, useState } from "react";
import type { RunDetail } from "@/lib/graphids/types";

// Polls /api/runs/<id> every 2 s while the run is still going.
export function useRun(runId: string | null, reloadKey = 0) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const r = await fetch(`/api/runs/${runId}`);
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load the run");
        if (cancelled) return;
        setRun(body.run);
        setError(null);
        if (body.run.status === "running") timer = setTimeout(tick, 2000);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        timer = setTimeout(tick, 5000);
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, reloadKey]);

  // Never show the previous run's data while a different run is loading.
  return { run: runId && run?.id === runId ? run : null, error };
}
