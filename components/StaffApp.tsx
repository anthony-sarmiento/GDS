"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { loadMyDay, MyDay, pressBreak } from "@/lib/cloud";
import { Profile } from "@/lib/supabase";
import { operatingDate, operatingMinutes, prettyDate, fmt, fmtDuration } from "@/lib/time";
import { breakStatus } from "@/lib/breaks";
import { cellKey } from "@/lib/rotation";
import { loadState, mergeSettings } from "@/lib/store";
import { Brk, Cell, POSITION_LABEL, Shift } from "@/lib/types";

const cellName = (c: Cell | undefined) => (!c ? null : c.pos === "other" ? (c.label ?? "Custom") : POSITION_LABEL[c.pos]);

/** Breaks as the staff member sees them: what the lead saved, plus their own presses the lead's screen has not applied yet. */
function withPending(shift: Shift, events: NonNullable<MyDay["events"]>): Brk[] {
  return shift.breaks.map((b) => {
    let out = b;
    for (const e of events) {
      if (e.break_id !== b.id) continue;
      out = e.kind === "start" ? { ...out, start: e.at, end: null } : { ...out, end: e.at };
    }
    return out;
  });
}

/**
 * The retail side: where am I now, where am I going next, and my breaks. Nothing else.
 * Starting or ending a break updates the lead's break sheet.
 */
export default function StaffApp({ profile, cloud, onSignOut }: { profile: Profile; cloud: boolean; onSignOut: () => void }) {
  const [clock, setClock] = useState(() => new Date());
  const [mine, setMine] = useState<MyDay | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const date = operatingDate(clock);
  const now = operatingMinutes(clock);

  const refresh = useCallback(async () => {
    if (!cloud) {
      // developing on this computer: show the first person on the board from this browser's saved day
      const st = loadState();
      const sh = st.days[operatingDate(new Date())]?.shifts.find((x) => !x.role);
      const day = st.days[operatingDate(new Date())];
      setMine(
        sh && day
          ? {
              linked: true,
              name: sh.name,
              shifts: [sh],
              cells: Object.fromEntries(Object.entries(day.cells).filter(([k]) => k.startsWith(sh.id + "@"))),
              settings: st.settings,
              events: [],
            }
          : { linked: false },
      );
      return;
    }
    const res = await loadMyDay(operatingDate(new Date()));
    setFailed(res == null);
    if (res) setMine(res);
  }, [cloud]);

  useEffect(() => {
    void refresh();
    const a = setInterval(() => setClock(new Date()), 15000);
    const b = setInterval(() => void refresh(), 15000);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(a);
      clearInterval(b);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const settings = useMemo(() => mergeSettings(mine?.settings ?? undefined), [mine?.settings]);
  const g = settings.gridMinutes;
  const shifts = mine?.shifts ?? [];
  // the shift that is on now, otherwise the next one, otherwise the last
  const shift = shifts.find((s) => s.start <= now && now < s.end) ?? shifts.find((s) => s.start > now) ?? shifts[shifts.length - 1];

  const breaks = shift ? withPending(shift, mine?.events ?? []) : [];
  const active = breaks.find((b) => breakStatus(b) === "active");
  const owed = breaks.filter((b) => breakStatus(b) !== "done" && breakStatus(b) !== "active");
  const done = breaks.filter((b) => breakStatus(b) === "done");

  const colAt = (t: number) => settings.anchor + Math.floor((t - settings.anchor) / g) * g;
  const cells = mine?.cells ?? {};
  const cellAtTime = (t: number) => (shift ? cells[cellKey(shift.id, colAt(t))] : undefined);
  const here = shift && now >= shift.start - 60 ? cellAtTime(Math.max(now, shift.start)) : undefined;

  // the next thing that is different from now
  const next = useMemo(() => {
    if (!shift) return null;
    const from = Math.max(now, shift.start);
    const nowCell = cells[cellKey(shift.id, colAt(from))];
    const nowName = cellName(nowCell);
    for (let t = colAt(from) + g; t < shift.end; t += g) {
      const c = cells[cellKey(shift.id, t)];
      const name = cellName(c);
      if (c?.transit) continue;
      if (name && name !== nowName) return { name, at: t };
      if (!name && nowName) return { name: "Nothing assigned yet", at: t };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, cells, now, g, settings.anchor]);

  const plannedBreak = owed.find((b) => b.planned != null && b.planned + b.length > now);
  const bumpedOut = shift?.sentHomeAt != null && now >= shift.sentHomeAt;

  async function press(b: Brk, kind: "start" | "end") {
    if (!shift || busy || !cloud) return;
    setBusy(true);
    const ok = await pressBreak(date, shift.id, b.id, kind, now);
    if (ok) await refresh();
    else setFailed(true);
    setBusy(false);
  }

  // what to show for "right now"
  let heading = "Nothing assigned yet";
  let tone = "none";
  let sub = "";
  if (shift) {
    if (active) {
      heading = "On break";
      tone = "break";
      sub = `since ${fmt(active.start ?? now)}`;
    } else if (here?.transit) {
      const to = (() => {
        for (let t = colAt(now) + g; t < shift.end; t += g) {
          const c = cells[cellKey(shift.id, t)];
          if (c && !c.transit) return cellName(c);
        }
        return null;
      })();
      heading = to ? `Head to ${to}` : "Moving";
      tone = "moving";
      sub = "You are on your way";
    } else if (here) {
      heading = cellName(here) ?? heading;
      tone = here.pos === "other" ? "other" : here.pos;
      sub = now < shift.start ? `You start here at ${fmt(shift.start)}` : "";
    } else if (now < shift.start) {
      sub = `Your shift starts at ${fmt(shift.start)}`;
    }
  }

  return (
    <div className="shell staff">
      <header className="topbar">
        <div className="brand">
          <Image src="/geekd-logo.webp" alt="GEEK'D Trading Cards & More" width={200} height={92} priority />
          <div className="brand-text">
            <h1>GDS</h1>
            <span>{profile.name || profile.email}</span>
          </div>
        </div>
        <div className="tools">
          <button className="btn ghost small" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <p className="muted" style={{ marginTop: -8 }}>
        {prettyDate(date)}
      </p>

      {mine == null && !failed && <div className="card muted">Loading…</div>}
      {failed && <div className="card note warn">Could not reach GDS. Trying again…</div>}

      {mine && !mine.linked && (
        <div className="card">
          <h2>Almost there</h2>
          <p className="muted">
            Your Google account ({profile.email}) is not linked to a team member yet. Ask your lead to add your email under Team → People.
          </p>
        </div>
      )}

      {mine?.linked && !shift && (
        <div className="card">
          <h2>Hi {mine.name}</h2>
          <p className="muted">You are not on today&rsquo;s schedule.</p>
        </div>
      )}

      {shift && (
        <>
          {bumpedOut && (
            <div className="staff-bump" role="alert">
              <b>It&rsquo;s time for your bumpout!</b>
              <span>Head to the iPad and clock out in Sling.{shift.bumpedBy ? ` ${shift.bumpedBy} is taking over.` : ""}</span>
            </div>
          )}

          <div className={`staff-now tone-${tone}`}>
            <small>Right now</small>
            <strong>{heading}</strong>
            {sub && <span>{sub}</span>}
          </div>

          {!active && next && !bumpedOut && (
            <div className="card staff-next">
              <small>Next</small>
              <b>{next.name}</b>
              <span>at {fmt(next.at)}</span>
            </div>
          )}

          {shift.sentHomeAt != null && !bumpedOut && (
            <div className="card staff-next">
              <small>Bumpout</small>
              <b>{fmt(shift.sentHomeAt)}</b>
              <span>{shift.bumpedBy ? `${shift.bumpedBy} takes over` : ""}</span>
            </div>
          )}

          <div className="card staff-breaks">
            <h2>Breaks</h2>
            {active && (
              <div className="staff-break active">
                <div>
                  <b>On break</b>
                  <span>started {fmt(active.start ?? now)}</span>
                </div>
                <button className="btn primary big" disabled={busy} onClick={() => press(active, "end")}>
                  End break
                </button>
              </div>
            )}
            {!active &&
              owed.map((b) => (
                <div className="staff-break" key={b.id}>
                  <div>
                    <b>{b.length >= 30 ? "30–60 min break" : `${b.length} min break`}</b>
                    <span>{b.planned != null ? `Planned ${fmt(b.planned)}` : "Not planned yet"}</span>
                  </div>
                  <button className="btn primary big" disabled={busy} onClick={() => press(b, "start")}>
                    Start break
                  </button>
                </div>
              ))}
            {active && owed.length > 0 && (
              <div className="muted">Still to take: {owed.map((b) => (b.length >= 30 ? "30–60 min" : `${b.length} min`)).join(", ")}</div>
            )}
            {done.map((b) => (
              <div className="staff-break done" key={b.id}>
                <div>
                  <b>{b.length >= 30 ? "30–60 min break" : `${b.length} min break`}</b>
                  <span>
                    taken {fmt(b.start ?? 0)}
                    {b.end != null && b.start != null ? ` · ${fmtDuration(b.end - b.start)}` : ""}
                  </span>
                </div>
                <span className="muted">✓</span>
              </div>
            ))}
            {!breaks.length && <div className="muted">No breaks on your shift.</div>}
            {plannedBreak && !active && <div className="muted">Your lead planned a break for {fmt(plannedBreak.planned ?? 0)}.</div>}
          </div>

          <p className="muted" style={{ textAlign: "center" }}>
            {fmt(shift.start)}–{fmt(shift.end)}
          </p>
        </>
      )}
    </div>
  );
}
