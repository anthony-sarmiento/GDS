"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AppState, DayState, Settings } from "@/lib/types";
import {
  addDays,
  fmt,
  fromInput,
  operatingDate,
  operatingMinutes,
  prettyDate,
  toInput,
} from "@/lib/time";
import { emptyDay, initialState, loadState, refresh, rememberName, saveState } from "@/lib/store";
import { planBreaks, breakStatus } from "@/lib/breaks";
import { cellKey, cellsFor, isPresent, rotating } from "@/lib/rotation";
import { Ctx, CoverPrompt } from "./ctx";
import CoverDialog from "./CoverDialog";
import BoardTab from "./BoardTab";
import BreaksTab from "./BreaksTab";
import TeamTab from "./TeamTab";

type Tab = "board" | "breaks" | "team";

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [clock, setClock] = useState<Date>(() => new Date());
  const [date, setDate] = useState<string>(() => operatingDate(new Date()));
  const [preview, setPreview] = useState<number | null>(null);
  const [editingClock, setEditingClock] = useState(false);
  const [tab, setTab] = useState<Tab>("board");
  const [toast, setToast] = useState<string | null>(null);
  const [coverPrompt, setCoverPrompt] = useState<CoverPrompt | null>(null);

  // load saved data once we're in the browser
  useEffect(() => {
    const loaded = loadState();
    setState(loaded);
    const today = operatingDate(new Date());
    setDate(today);
    setTab(loaded.days[today]?.shifts.length ? "board" : "team");
    setHydrated(true);
  }, []);

  // persist
  useEffect(() => {
    if (hydrated) saveState(state);
  }, [state, hydrated]);

  // tick the real clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  const day: DayState = state.days[date] ?? emptyDay(date);
  const live = date === operatingDate(clock);
  const now = preview ?? (live ? operatingMinutes(clock) : null);
  const nowRef = useRef<number | null>(now);
  nowRef.current = now;

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const mutate: Ctx["mutate"] = useCallback(
    (fn, opts) => {
      setState((prev) => {
        const base = prev.days[date] ?? emptyDay(date);
        let next = fn(base);
        if (opts?.replanBreaks) {
          next = planBreaks(next, prev.settings, { replanAll: true, notBefore: nowRef.current ?? -Infinity });
        }
        if (opts?.auto) next = refresh(next, prev, nowRef.current, opts.auto === "fill" ? "fill" : opts.auto === "cells" ? "cells" : "redeal");
        return { ...prev, days: { ...prev.days, [date]: next } };
      });
    },
    [date],
  );

  const setSettings = useCallback(
    (patch: Partial<Settings>) => {
      setState((prev) => {
        const settings = { ...prev.settings, ...patch };
        const gridChanged =
          settings.gridMinutes !== prev.settings.gridMinutes || settings.anchor !== prev.settings.anchor;
        const base = prev.days[date] ?? emptyDay(date);
        const next: AppState = { ...prev, settings };
        let day = base;
        if (gridChanged) {
          // old column keys no longer line up, so deal the viewed day again from scratch
          day = refresh({ ...base, cells: {} }, next, nowRef.current);
        } else if (patch.rotationMinutes !== undefined || patch.limits !== undefined) {
          day = refresh(base, next, nowRef.current);
        } else if (patch.maxConcurrentBreaks !== undefined) {
          day = refresh(
            planBreaks(base, settings, { replanAll: true, notBefore: nowRef.current ?? -Infinity }),
            next,
            nowRef.current,
          );
        }
        return { ...next, days: { ...prev.days, [date]: day } };
      });
    },
    [date],
  );

  const remember = useCallback((name: string) => {
    setState((prev) => ({ ...prev, names: rememberName(prev.names, name) }));
  }, []);

  // A day opened later (or after changing block length) may have blocks with no position yet.
  useEffect(() => {
    if (!hydrated || !day.shifts.length) return;
    const g = state.settings.gridMinutes;
    const gaps = cellsFor(day.shifts, state.settings).some((c) =>
      rotating(day.shifts).some((s) => isPresent(s, c, g) && !day.cells[cellKey(s.id, c)]),
    );
    const unplaced = day.shifts.some((s) => s.breaks.some((b) => b.planned == null && b.start == null));
    if (gaps || unplaced) mutate((d) => d, { auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, date, day.shifts.length]);

  const ctx: Ctx = useMemo(
    () => ({ state, day, settings: state.settings, now, live: live && preview == null, mutate, setSettings, remember, flash, askCover: setCoverPrompt }),
    [state, day, now, live, preview, mutate, setSettings, remember, flash],
  );

  const remaining = day.shifts.reduce(
    (n, s) => n + s.breaks.filter((b) => breakStatus(b) !== "done").length,
    0,
  );

  if (!hydrated) {
    return (
      <div className="shell">
        <div className="topbar">
          <div className="brand">
            <Image src="/geekd-logo.webp" alt="GEEK'D Trading Cards & More" width={200} height={92} priority />
          </div>
        </div>
      </div>
    );
  }

  const realNow = operatingMinutes(clock);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Image src="/geekd-logo.webp" alt="GEEK'D Trading Cards & More" width={200} height={92} priority />
          <div className="brand-text">
            <h1>GDS</h1>
            <span>Geek&rsquo;d Deployment System</span>
          </div>
        </div>

        <div className="datebar">
          <button className="btn icon" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            ‹
          </button>
          <input
            type="date"
            className="field"
            aria-label="Date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <button className="btn icon" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}>
            ›
          </button>
          {date !== operatingDate(clock) && (
            <button className="btn small" onClick={() => setDate(operatingDate(clock))}>
              Today
            </button>
          )}
        </div>

        <div className={`clock ${preview != null ? "preview" : ""}`}>
          <span className="dot" aria-hidden />
          {editingClock ? (
            <input
              type="time"
              className="field compact"
              autoFocus
              defaultValue={toInput(preview ?? realNow)}
              aria-label="Preview time"
              onBlur={(e) => {
                const m = fromInput(e.target.value);
                if (m != null) setPreview(m < 240 ? m + 1440 : m);
                setEditingClock(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button
              className="btn ghost small"
              onClick={() => setEditingClock(true)}
              title="Click to preview the board at another time"
            >
              {preview != null ? "Preview" : live ? "Live" : "Clock"} · <b>{fmt(preview ?? realNow)}</b>
            </button>
          )}
          {preview != null && (
            <button className="btn small" onClick={() => setPreview(null)}>
              Back to live
            </button>
          )}
        </div>
      </header>

      <div className="print-only print-title">GEEK&rsquo;D DAILY BREAK LOG</div>

      <nav className="tabs" role="tablist" aria-label="Sections">
        {(
          [
            ["board", "Board", null],
            ["breaks", "Breaks", day.shifts.length ? remaining : null],
            ["team", "Team", day.shifts.length || null],
          ] as [Tab, string, number | null][]
        ).map(([id, label, count]) => (
          <button
            key={id}
            role="tab"
            className="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
            {count != null && <span className="count">{count}</span>}
          </button>
        ))}
      </nav>

      <p className="muted no-print" style={{ marginTop: -8, marginBottom: 16 }}>
        {prettyDate(date)}
        {preview != null && " — previewing the board at a different time"}
      </p>

      <main>
        {tab === "board" && <BoardTab ctx={ctx} goTeam={() => setTab("team")} />}
        {tab === "breaks" && <BreaksTab ctx={ctx} goTeam={() => setTab("team")} />}
        {tab === "team" && <TeamTab ctx={ctx} />}
      </main>

      {coverPrompt && <CoverDialog key={coverPrompt.title + coverPrompt.when} prompt={coverPrompt} onClose={() => setCoverPrompt(null)} />}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
