"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Avatar from "./Avatar";
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
export default function StaffApp({
  profile,
  cloud,
  onSignOut,
  onSwitch,
}: {
  profile: Profile;
  cloud: boolean;
  onSignOut: () => void;
  /** Only for lead-side accounts: go back to the lead view. */
  onSwitch?: () => void;
}) {
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

  const first = (mine?.name ?? profile.name ?? "").trim().split(/\s+/)[0] || "there";
  const untilAt = !active && !bumpedOut && next ? next.at : null;

  return (
    <div className="shell staff">
      <header className="staff-top">
        <Image className="staff-logo" src="/geekd-logo.webp" alt="GEEK'D Trading Cards & More" width={120} height={55} priority />
        <div className="staff-actions">
          {onSwitch && (
            <button className="btn small" onClick={onSwitch}>
              Lead view
            </button>
          )}
          <button className="btn ghost small" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="staff-hello">
        <Avatar url={profile.avatar_url} name={mine?.name ?? profile.name ?? profile.email} size={52} />
        <div>
          <b>Hi {first}</b>
          <span>{prettyDate(date)}</span>
        </div>
      </div>

      {mine == null && !failed && <div className="card muted">Loading…</div>}
      {failed && <div className="note warn">Could not reach GDS. Trying again…</div>}

      {mine && !mine.linked && (
        <div className="card staff-empty">
          <h2>Almost there</h2>
          <p className="muted">
            Your Google account ({profile.email}) is not linked to a team member yet. Ask your lead to add your email in Admin → People.
          </p>
        </div>
      )}

      {mine?.linked && !shift && (
        <div className="card staff-empty">
          <h2>Nothing today</h2>
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

          <section className={`staff-hero tone-${tone}`} aria-label="Current position">
            <small>Current position</small>
            <strong>{heading}</strong>
            {sub && <span>{sub}</span>}
            {untilAt != null && <em>until {fmt(untilAt)}</em>}
          </section>

          {!active && next && !bumpedOut && (
            <div className="staff-row">
              <small>Next</small>
              <b>{next.name}</b>
              <span>{fmt(next.at)}</span>
            </div>
          )}

          {shift.sentHomeAt != null && !bumpedOut && (
            <div className="staff-row">
              <small>Bumpout</small>
              <b>{shift.bumpedBy ? `${shift.bumpedBy} takes over` : "Clock out"}</b>
              <span>{fmt(shift.sentHomeAt)}</span>
            </div>
          )}

          <section className="staff-breaks" aria-label="Breaks">
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
              <p className="muted">Still to take: {owed.map((b) => (b.length >= 30 ? "30–60 min" : `${b.length} min`)).join(", ")}</p>
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
                <span className="check">✓</span>
              </div>
            ))}
            {!breaks.length && <p className="muted">No breaks on your shift.</p>}
          </section>

          <p className="staff-shift">
            Your shift {fmt(shift.start)}–{fmt(shift.end)}
          </p>
        </>
      )}
    </div>
  );
}
