"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AppState, DayState, Settings, TeamMember } from "@/lib/types";
import { Profile, ROLE_LABEL } from "@/lib/supabase";
import {
  deleteMember as cloudDeleteMember,
  listenForEvents,
  loadAccounts,
  loadDay,
  loadOpenEvents,
  loadRecentDays,
  loadSettings,
  loadTeam,
  markApplied,
  saveDay,
  saveMember as cloudSaveMember,
  saveSettings,
} from "@/lib/cloud";
import {
  addDays,
  fmt,
  fmtDuration,
  fromInput,
  operatingDate,
  operatingMinutes,
  prettyDate,
  toInput,
} from "@/lib/time";
import {
  emptyDay,
  endBreak,
  finishBumpout,
  holdOver,
  initialState,
  loadState,
  mergeSettings,
  needsHoldOver,
  refresh,
  rememberName,
  saveState,
  startBreak,
} from "@/lib/store";
import { breakStatus } from "@/lib/breaks";
import { Ctx, CoverPrompt } from "./ctx";
import { emptyHistory, History, recordChange, stepBack, stepForward } from "@/lib/history";
import CoverDialog from "./CoverDialog";
import BoardTab from "./BoardTab";
import BreaksTab from "./BreaksTab";
import TeamTab from "./TeamTab";
import HistoryTab from "./HistoryTab";
import AdminTab from "./AdminTab";
import ChecksTab, { ago } from "./ChecksTab";
import { addCheck, checkStatus } from "@/lib/checks";

type Tab = "board" | "breaks" | "checks" | "history" | "team" | "admin";

export default function App({
  profile,
  cloud,
  onSignOut,
  onSwitch,
}: {
  profile: Profile;
  cloud: boolean;
  onSignOut: () => void;
  /** Look at the staff side (for a lead who is also scheduled on the floor). */
  onSwitch: () => void;
}) {
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [clock, setClock] = useState<Date>(() => new Date());
  const [date, setDate] = useState<string>(() => operatingDate(new Date()));
  const [preview, setPreview] = useState<number | null>(null);
  const [editingClock, setEditingClock] = useState(false);
  const [tab, setTab] = useState<Tab>("board");
  const [toast, setToast] = useState<string | null>(null);
  const [coverPrompt, setCoverPrompt] = useState<CoverPrompt | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);
  const [cloudReady, setCloudReady] = useState(!cloud);
  const [sync, setSync] = useState<"saved" | "saving" | "error">("saved");
  const isAdmin = cloud && profile.role === "owner";
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const savedDays = useRef<Record<string, string>>({});
  const savedSettings = useRef<string>("");

  // load saved data once we're in the browser
  useEffect(() => {
    const loaded = loadState();
    setState(loaded);
    const today = operatingDate(new Date());
    setDate(today);
    setTab(loaded.days[today]?.shifts.length ? "board" : "team");
    setHydrated(true);
  }, []);

  const ready = hydrated && cloudReady;

  // keep a copy in this browser too, so a dropped connection never loses the day
  useEffect(() => {
    if (ready) saveState(state);
  }, [state, ready]);

  // pull the saved days, settings and people from the database once, and upload anything only this browser has
  useEffect(() => {
    if (!hydrated || !cloud) return;
    let cancelled = false;
    (async () => {
      const today = operatingDate(new Date());
      const [days, settings, team] = await Promise.all([loadRecentDays(addDays(today, -14)), loadSettings(), loadTeam()]);
      if (cancelled) return;
      setState((prev) => {
        const merged = settings ? mergeSettings(settings) : prev.settings;
        const next: AppState = { ...prev, settings: merged, team: team.length ? team : prev.team ?? [] };
        const out: Record<string, DayState> = { ...prev.days };
        for (const [d, v] of Object.entries(days)) {
          out[d] = refresh(v, next);
          savedDays.current[d] = JSON.stringify(v);
        }
        if (settings) savedSettings.current = JSON.stringify(settings);
        return { ...next, days: out, names: Array.from(new Set([...prev.names, ...team.map((t) => t.name)])) };
      });
      setCloudReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, cloud]);

  // faces for the names on the board
  useEffect(() => {
    if (!cloud || !cloudReady) return;
    let cancelled = false;
    void loadAccounts().then((rows) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const r of rows) if (r.avatar_url) map[r.email.trim().toLowerCase()] = r.avatar_url;
      if (profile.avatar_url) map[profile.email.trim().toLowerCase()] = profile.avatar_url;
      setAvatars(map);
    });
    return () => {
      cancelled = true;
    };
  }, [cloud, cloudReady, profile.avatar_url, profile.email]);

  // a day that is not loaded yet (an older date picked from the date box or History)
  useEffect(() => {
    if (!cloud || !cloudReady || stateRef.current.days[date]) return;
    let cancelled = false;
    void loadDay(date).then((d) => {
      if (cancelled || !d) return;
      savedDays.current[date] = JSON.stringify(d);
      setState((prev) => ({ ...prev, days: { ...prev.days, [date]: refresh(d, prev) } }));
    });
    return () => {
      cancelled = true;
    };
  }, [cloud, cloudReady, date]);

  // Every change is saved to the database a moment later. A failed save is tried again, and the page
  // warns before it is closed while something is still unsaved.
  const flushing = useRef(false);
  const isDirty = useCallback(() => {
    const st = stateRef.current;
    const days = Object.entries(st.days).some(([d, v]) => {
      if (!v.shifts.length && !(v.checks ?? []).length && savedDays.current[d] == null) return false;
      return JSON.stringify(v) !== savedDays.current[d];
    });
    return days || JSON.stringify(st.settings) !== savedSettings.current;
  }, []);

  const flush = useCallback(async () => {
    if (!cloud || flushing.current) return;
    flushing.current = true;
    setSync("saving");
    let ok = true;
    try {
      const st = stateRef.current;
      for (const [d, v] of Object.entries(st.days)) {
        if (!v.shifts.length && !(v.checks ?? []).length && savedDays.current[d] == null) continue;
        const json = JSON.stringify(v);
        if (savedDays.current[d] === json) continue;
        if (await saveDay(v, profile.id)) savedDays.current[d] = json;
        else ok = false;
      }
      const sj = JSON.stringify(st.settings);
      if (savedSettings.current !== sj) {
        if (await saveSettings(st.settings)) savedSettings.current = sj;
        else ok = false;
      }
    } catch {
      ok = false;
    } finally {
      flushing.current = false;
    }
    // something changed while saving: go round again shortly
    setSync(ok && !isDirty() ? "saved" : ok ? "saving" : "error");
  }, [cloud, profile.id, isDirty]);

  useEffect(() => {
    if (!cloud || !cloudReady) return;
    if (isDirty()) setSync((s) => (s === "error" ? s : "saving"));
    const t = window.setTimeout(() => void flush(), 700);
    return () => window.clearTimeout(t);
  }, [state.days, state.settings, cloud, cloudReady, flush, isDirty]);

  useEffect(() => {
    if (!cloud || !cloudReady) return;
    const retry = window.setInterval(() => isDirty() && void flush(), 8000);
    const onHide = () => document.visibilityState === "hidden" && isDirty() && void flush();
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      void flush();
      e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.clearInterval(retry);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [cloud, cloudReady, flush, isDirty]);

  // another device may have changed the day: when this one has nothing unsaved, take the newer copy
  useEffect(() => {
    if (!cloud || !cloudReady) return;
    const pull = async () => {
      if (isDirty() || flushing.current) return;
      const d = await loadDay(date);
      if (!d || isDirty() || flushing.current) return;
      const json = JSON.stringify(d);
      if (json === savedDays.current[date]) return;
      savedDays.current[date] = json;
      setState((prev) => ({ ...prev, days: { ...prev.days, [date]: refresh(d, prev) } }));
    };
    const id = window.setInterval(() => void pull(), 15000);
    const onShow = () => document.visibilityState === "visible" && void pull();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [cloud, cloudReady, date, isDirty]);

  // break starts and stops pressed on staff phones land here
  useEffect(() => {
    if (!cloud || !cloudReady) return;
    let running = false;
    const apply = async () => {
      if (running) return;
      running = true;
      try {
        const events = await loadOpenEvents();
        if (!events.length) return;
        const notes: string[] = [];
        setState((prev) => {
          const days = { ...prev.days };
          for (const e of events) {
            const d = days[e.date];
            const sh = d?.shifts.find((x) => x.id === e.shift_id);
            if (!d || !sh) continue;
            if (e.kind === "bumpout") {
              if (sh.sentHomeAt == null) {
                days[e.date] = refresh(finishBumpout(d, prev.settings, sh.id, e.at), prev);
                notes.push(sh.name + " bumped out at " + fmt(e.at));
              }
              continue;
            }
            const br = sh.breaks.find((x) => x.id === e.break_id);
            if (!br) continue;
            if (e.kind === "start" && br.start == null) {
              days[e.date] = refresh(startBreak(d, sh.id, br.id, e.at), prev);
              notes.push(sh.name + " started a break at " + fmt(e.at));
            } else if (e.kind === "end" && br.start != null && br.end == null) {
              days[e.date] = refresh(endBreak(d, sh.id, br.id, e.at), prev);
              notes.push(sh.name + " ended their break at " + fmt(e.at));
            }
          }
          return { ...prev, days };
        });
        await markApplied(events.map((e) => e.id));
        if (notes.length) flash(notes.join(" · "));
      } finally {
        running = false;
      }
    };
    void apply();
    const stop = listenForEvents(() => void apply());
    const poll = window.setInterval(() => void apply(), 30000);
    return () => {
      stop();
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, cloudReady]);

  // tick the real clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  // nobody drops off the board at their scheduled out time: they stay on until they are bumped out
  useEffect(() => {
    if (!ready) return;
    const today = operatingDate(clock);
    const t = operatingMinutes(clock);
    const d = stateRef.current.days[today];
    if (!d || !needsHoldOver(d, t)) return;
    setState((prev) => {
      const base = prev.days[today];
      return base ? { ...prev, days: { ...prev.days, [today]: refresh(holdOver(base, t), prev) } } : prev;
    });
  }, [clock, ready]);

  const day: DayState = state.days[date] ?? emptyDay(date);
  const live = date === operatingDate(clock);
  const now = preview ?? (live ? operatingMinutes(clock) : null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // undo / redo, kept per day and only for this visit (a reload starts fresh)
  const histRef = useRef<Record<string, History<DayState>>>({});
  const [, bumpHistory] = useState(0);
  const hist = histRef.current[date] ?? emptyHistory<DayState>();
  const sameDay = (a: DayState, b: DayState) => a === b || JSON.stringify(a) === JSON.stringify(b);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const mutate: Ctx["mutate"] = useCallback(
    (fn, opts) => {
      if (opts?.record !== false) {
        const before = stateRef.current.days[date] ?? emptyDay(date);
        histRef.current[date] = recordChange(histRef.current[date] ?? emptyHistory<DayState>(), before, Date.now());
        bumpHistory((n) => n + 1);
      }
      setState((prev) => {
        const base = prev.days[date] ?? emptyDay(date);
        let next = fn(base);
        if (opts?.auto) next = refresh(next, prev);
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
          // old column keys no longer line up, so start the viewed day's board again
          day = refresh({ ...base, cells: {} }, next);
        }
        return { ...next, days: { ...prev.days, [date]: day } };
      });
    },
    [date],
  );

  const remember = useCallback((name: string) => {
    setState((prev) => ({ ...prev, names: rememberName(prev.names, name) }));
  }, []);

  const saveMember = useCallback(
    (m: TeamMember) => {
      setState((prev) => {
        const team = [...(prev.team ?? []).filter((x) => x.id !== m.id), m].sort((a, b) => a.name.localeCompare(b.name));
        return { ...prev, team, names: rememberName(prev.names, m.name) };
      });
      if (cloud) void cloudSaveMember(m);
    },
    [cloud],
  );

  const removeMember = useCallback(
    (id: string) => {
      setState((prev) => ({ ...prev, team: (prev.team ?? []).filter((x) => x.id !== id) }));
      if (cloud) void cloudDeleteMember(id);
    },
    [cloud],
  );

  const undo = useCallback(() => {
    const current = stateRef.current.days[date] ?? emptyDay(date);
    const { history, state: snap } = stepBack(histRef.current[date] ?? emptyHistory<DayState>(), current, sameDay);
    histRef.current[date] = history;
    bumpHistory((n) => n + 1);
    if (!snap) return;
    setState((prev) => ({ ...prev, days: { ...prev.days, [date]: snap } }));
    flash("Undid the last change");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, flash]);

  const redo = useCallback(() => {
    const current = stateRef.current.days[date] ?? emptyDay(date);
    const { history, state: snap } = stepForward(histRef.current[date] ?? emptyHistory<DayState>(), current, sameDay);
    histRef.current[date] = history;
    bumpHistory((n) => n + 1);
    if (!snap) return;
    setState((prev) => ({ ...prev, days: { ...prev.days, [date]: snap } }));
    flash("Redid the change");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, flash]);

  // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Text boxes keep their own typing undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const ctx: Ctx = useMemo(
    () => ({
      state,
      day,
      settings: state.settings,
      now,
      live: live && preview == null,
      mutate,
      setSettings,
      remember,
      flash,
      askCover: setCoverPrompt,
      cloud,
      team: state.team ?? [],
      avatars,
      saveMember,
      removeMember,
    }),
    [state, day, now, live, preview, mutate, setSettings, remember, flash, cloud, avatars, saveMember, removeMember],
  );

  // gentle reminder when it has been a while since the last bathroom check; "Later" hides it for 30 minutes
  const checks = checkStatus(day, state.settings, now);
  const showNudge = checks.due && tab !== "checks" && (snoozeUntil == null || (now ?? 0) >= snoozeUntil);

  const remaining = day.shifts.reduce(
    (n, s) => n + s.breaks.filter((b) => breakStatus(b) !== "done").length,
    0,
  );

  if (!ready) {
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

        <div className="tools">
        <div className="acct no-print">
          {cloud && (
            <span className={`sync ${sync}`} role="status">
              {sync === "saved" ? "✓ Saved" : sync === "saving" ? "Saving…" : "⚠ Not saved, retrying"}
            </span>
          )}
          <span>
            <b>{profile.name || profile.email}</b> · {ROLE_LABEL[profile.role]}
          </span>
          <button className="btn small" onClick={onSwitch} title="See your own shift, the way staff see it">
            My shift
          </button>
          <button className="btn ghost small" onClick={onSignOut}>
            Sign out
          </button>
        </div>
        <div className="undo-group" role="group" aria-label="Undo and redo">
          <button
            className="btn"
            onClick={undo}
            disabled={hist.undo.length === 0}
            title="Undo the last change (Ctrl+Z)"
            aria-label="Undo"
          >
            ↶ <span className="undo-text">Undo</span>
          </button>
          <button
            className="btn ghost"
            onClick={redo}
            disabled={hist.redo.length === 0}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            ↷ <span className="undo-text">Redo</span>
          </button>
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
        </div>
      </header>

      <div className="print-only print-title">GEEK&rsquo;D DAILY BREAK LOG</div>

      <nav className="tabs" role="tablist" aria-label="Sections">
        {(
          [
            ["board", "Board", null],
            ["breaks", "Breaks", day.shifts.length ? remaining : null],
            ["checks", "Checks", null],
            ...(cloud ? ([["history", "History", null]] as [Tab, string, number | null][]) : []),
            ["team", "Team", day.shifts.length || null],
            ...(isAdmin ? ([["admin", "Admin", null]] as [Tab, string, number | null][]) : []),
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
            {id === "checks" && checks.due && <span className="count alert" aria-label="Check due">!</span>}
          </button>
        ))}
      </nav>

      <p className="muted no-print" style={{ marginTop: -8, marginBottom: 16 }}>
        {prettyDate(date)}
      </p>

      {showNudge && checks.since != null && (
        <div className="nudge no-print" role="status">
          <span className="nudge-icon" aria-hidden>
            🚻
          </span>
          <p>
            {checks.never ? (
              <>
                <b>Hey!</b> No bathroom check has been logged yet. The store has been open {fmtDuration(checks.since)}.
              </>
            ) : (
              <>
                <b>Hey!</b> Your last bathroom check was <b>{ago(checks.since)}</b>.
              </>
            )}
          </p>
          <button
            className="btn primary small"
            onClick={() => {
              mutate((d) => addCheck(d, now ?? 0));
              flash(`Bathroom check logged at ${fmt(now ?? 0)}`);
            }}
          >
            Log a check
          </button>
          <button className="btn ghost small" onClick={() => setSnoozeUntil((now ?? 0) + 30)}>
            Later
          </button>
        </div>
      )}

      <main>
        {tab === "board" && <BoardTab ctx={ctx} goTeam={() => setTab("team")} />}
        {tab === "checks" && <ChecksTab ctx={ctx} />}
        {tab === "breaks" && <BreaksTab ctx={ctx} goTeam={() => setTab("team")} />}
        {tab === "history" && (
          <HistoryTab
            ctx={ctx}
            onOpen={(d) => {
              setDate(d);
              setTab("board");
            }}
          />
        )}
        {tab === "team" && <TeamTab ctx={ctx} />}
        {tab === "admin" && isAdmin && <AdminTab ctx={ctx} selfId={profile.id} />}
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
