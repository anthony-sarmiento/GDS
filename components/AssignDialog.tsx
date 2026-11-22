"use client";

import { useEffect, useMemo, useState } from "react";
import { Ctx } from "./ctx";
import CoverPicker from "./CoverPicker";
import TimeSelect from "./TimeSelect";
import { CellPos, Position, POSITION_LABEL, Shift } from "@/lib/types";
import { breakAtCell, cellAt, cellKey, cellsFor, isPresent, rotating, staffAt } from "@/lib/rotation";
import { applyChain, ChainMove, peopleAt } from "@/lib/chain";
import { analyzeCover, applyBreakChange, coverOptions } from "@/lib/cover";
import { assignRange, paintCells, placeBreak } from "@/lib/store";
import { loadLabels, pushLabel, saveLabels } from "@/lib/labels";
import { fmt, fmtDuration } from "@/lib/time";
import { breakKind, breaksOwed, KIND_LABEL, onLog } from "@/lib/breaks";

const round5 = (t: number) => Math.round(t / 5) * 5;

type Where = CellPos | "break";

/** One more person in a rotation chain. */
type ChainWhere = Position | "break" | "bumpout";
interface ChainStep {
  who: string;
  where: ChainWhere | "";
  /** When this person starts. null = at the time of the whole rotation. */
  from: number | null;
  /** When they stop. null = until their bumpout (a break always has an end time). */
  until: number | null;
}
const CHAIN_WHERE: { id: ChainWhere; label: string; cls: string }[] = [
  { id: "front", label: "Front", cls: "pos-front" },
  { id: "bar", label: "Bar", cls: "pos-bar" },
  { id: "dungeon", label: "Dungeon", cls: "pos-dungeon" },
  { id: "break", label: "Break", cls: "brush-break" },
  { id: "bumpout", label: "Bumpout", cls: "brush-bump" },
];
const chainDest = (w: ChainWhere | "") => (w === "" ? "…" : w === "break" ? "Break" : w === "bumpout" ? "Bumpout" : POSITION_LABEL[w]);
const isSpot = (w: string): w is Position => w === "front" || w === "bar" || w === "dungeon";

const WHERE: { id: Where; label: string; cls: string }[] = [
  { id: "front", label: "Front", cls: "pos-front" },
  { id: "bar", label: "Bar", cls: "pos-bar" },
  { id: "dungeon", label: "Dungeon", cls: "pos-dungeon" },
  { id: "other", label: "Custom", cls: "pos-other" },
  { id: "break", label: "Break", cls: "brush-break" },
];

/**
 * Push an assignment, CDS style: send someone somewhere (or on break) at a time, for as long as you say.
 * Shows what it does to the position they leave, and lets you choose who rotates over. Nothing is
 * moved unless you pick it.
 */
export default function AssignDialog({
  ctx,
  shiftId,
  at,
  startWhere,
  onClose,
}: {
  ctx: Ctx;
  shiftId?: string;
  at?: number;
  /** Open with "break" already picked. */
  startWhere?: Where;
  onClose: () => void;
}) {
  const { day, settings, now, mutate, flash } = ctx;
  const g = settings.gridMinutes;
  const crew = rotating(day.shifts).filter((s) => s.sentHomeAt == null);

  const firstShift = crew.find((s) => s.id === shiftId) ?? crew[0];
  const [who, setWho] = useState(firstShift?.id ?? "");
  const person = crew.find((s) => s.id === who) ?? firstShift;

  const [where, setWhere] = useState<Where>(startWhere ?? "front");
  const [label, setLabel] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(loadLabels()), []);

  // the break log decides the default: the first break this person still owes (20, or 30 for the long kind)
  const breakLen = (p: typeof person) =>
    (p?.breaks.find((b) => b.start == null && b.planned == null) ?? p?.breaks.find((b) => b.start == null))?.length ?? 20;
  // a position is held until the lead moves the person, so the default is the rest of the shift
  // (a custom spot like a tournament is usually shorter, so that one defaults to an hour)
  const defaultEnd = (p: NonNullable<typeof person>, f: number, w: Where) =>
    Math.min(w === "break" ? f + breakLen(p) : p.end, p.end);
  // Someone with nothing assigned yet starts from where their shift starts (or the first gap), so a
  // starting position covers the time they have been here too. Otherwise it starts now.
  const firstOpen = (p: NonNullable<typeof person>): number | null => {
    const c = cellsFor(day.shifts, settings).find((x) => isPresent(p, x, g) && !day.cells[cellKey(p.id, x)]);
    return c == null ? null : Math.max(c, p.start);
  };
  // a break starts when you send them (now); a position starts from the first unassigned time
  const startFor = (p: NonNullable<typeof person>, w: Where = where) =>
    round5(Math.min(Math.max(at ?? (w === "break" ? null : firstOpen(p)) ?? now ?? p.start, p.start), p.end - g));
  const startGuess = person ? startFor(person, startWhere ?? "front") : 0;
  const [from, setFrom] = useState(startGuess);
  const [until, setUntil] = useState(person ? defaultEnd(person, startGuess, startWhere ?? "front") : startGuess + 60);
  // undefined = nothing picked yet, null = Nobody, otherwise the shift id of who rotates over
  const [coverChoice, setCoverChoice] = useState<string | null | undefined>(undefined);
  useEffect(() => setCoverChoice(undefined), [who, where, from, until]);

  // rotation chain: more people who move as part of this same action
  const [chain, setChain] = useState<ChainStep[]>([]);
  const [open, setOpen] = useState(0);

  const isBreak = where === "break";
  const cellsAll = useMemo(() => cellsFor(day.shifts, settings), [day.shifts, settings]);
  const targetCells = useMemo(
    () => (person ? cellsAll.filter((c) => c + g > from && c < until && isPresent(person, c, g)) : []),
    [cellsAll, person, from, until, g],
  );
  const valid =
    !!person && until > from && targetCells.length > 0 && (where !== "other" || label.trim().length > 0);

  // what this does to the board, judged at the worst moment of the stretch
  const impact = useMemo(() => {
    if (!person || !targetCells.length) return null;

    if (where === "break") {
      const probe = placeBreak(day, person.id, from, until - from);
      const a = probe.breakId ? analyzeCover(probe.day, settings, person.id, probe.breakId) : null;
      if (!a || !a.position) return { position: null as Position | null, needs: false, remaining: 0, min: 0, options: [], joined: null as number | null };
      return { position: a.position, needs: a.needs, remaining: a.remaining, min: a.min, options: a.options, joined: null as number | null };
    }

    const draft = paintCells(day, person.id, targetCells, where, label);
    const c0 = targetCells[0];
    const left = ((p) => (p && p !== "other" && p !== where ? (p as Position) : null))(day.cells[cellKey(person.id, c0)]?.pos);
    let worst = c0;
    let leftNow: number | null = null;
    if (left) {
      for (const c of targetCells) {
        if (day.cells[cellKey(person.id, c)]?.pos !== left) continue;
        const n = staffAt(draft, settings, c)[left].length;
        if (leftNow == null || n < leftNow) {
          leftNow = n;
          worst = c;
        }
      }
    }
    const joined = where !== "other" ? staffAt(draft, settings, c0)[where].length : null;
    if (!left || leftNow == null) return { position: null as Position | null, needs: false, remaining: 0, min: 0, options: [], joined };
    const o = coverOptions(draft, settings, left, [worst, ...targetCells.filter((c) => c !== worst)], person.id);
    return { position: left, needs: o.needs, remaining: leftNow, min: o.min, options: o.options, joined };
  }, [day, person, targetCells, where, label, settings, from, until]);

  const position = impact?.position ?? null;
  const needsCover = !!impact?.needs;
  // a cover is required for a short position; for a break it is optional when the position stays staffed
  const showPicker = valid && position != null && (needsCover || isBreak);
  const effective = coverChoice === undefined && !needsCover ? null : coverChoice;
  const blocked = showPicker && needsCover && effective === undefined;

  // Each extra step is "who at <the place the last person is going> moves, and where do they go".
  const chainInfo = useMemo(() => {
    const skip: string[] = person ? [person.id] : [];
    let prevPos: Position | null = isSpot(where) ? where : null;
    const rows: { step: ChainStep; prev: Position | null; cands: Shift[] }[] = [];
    for (const st of chain) {
      rows.push({ step: st, prev: prevPos, cands: prevPos ? peopleAt(day, settings, prevPos, from, skip) : [] });
      if (st.who) skip.push(st.who);
      prevPos = isSpot(st.where) ? st.where : null;
    }
    return { rows, tailPos: prevPos, skip };
  }, [chain, person, where, day, settings, from]);

  const chainMoves: ChainMove[] | null = useMemo(() => {
    if (!person || chain.length === 0 || !valid) return null;
    const moves: ChainMove[] = [{ shiftId: person.id, dest: where, label: label.trim() || undefined, until }];
    for (const r of chainInfo.rows) {
      const sh = r.cands.find((c) => c.id === r.step.who);
      if (!sh || r.step.where === "") return null;
      const stFrom = r.step.from ?? from;
      const until2 = Math.min(r.step.until ?? (r.step.where === "break" ? stFrom + 20 : sh.end), sh.end);
      if (r.step.where !== "bumpout" && until2 <= stFrom) return null;
      moves.push({ shiftId: sh.id, dest: r.step.where, from: stFrom, until: until2 });
    }
    return moves;
  }, [person, chain, chainInfo, valid, where, label, until, from]);

  // how many people are on each position once everything has moved
  const chainAfter = useMemo(() => {
    if (!chainMoves) return null;
    const draft = applyChain(day, settings, from, chainMoves);
    const col = cellAt(cellsFor(draft.shifts, settings), g, from + settings.transitMinutes);
    if (col == null) return null;
    const on = staffAt(draft, settings, col);
    const away = rotating(draft.shifts).filter((x) => isPresent(x, col, g) && breakAtCell(x, col, g)).length;
    return { counts: { front: on.front.length, bar: on.bar.length, dungeon: on.dungeon.length }, away };
  }, [chainMoves, day, settings, from, g]);

  if (!person) {
    return (
      <div className="modal-back" onClick={onClose} role="presentation">
        <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <h2>Assign</h2>
          <p className="muted">Nobody on the rotation to assign yet.</p>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  function changeWho(id: string) {
    setChain([]);
    setOpen(0);
    setWho(id);
    const p = crew.find((s) => s.id === id);
    if (!p) return;
    const f = at != null ? round5(Math.min(Math.max(from, p.start), p.end - g)) : startFor(p, where);
    setFrom(f);
    setUntil(defaultEnd(p, f, where));
  }

  function changeFrom(v: number) {
    const dur = until - from;
    setFrom(v);
    setUntil(Math.min(v + Math.max(dur, 5), person!.end));
  }

  function changeWhere(w: Where) {
    setChain([]);
    setOpen(0);
    setWhere(w);
    // keep a length you set yourself; only reset when switching between kinds of assignment
    if (w === "break" || isBreak || w === "other" || where === "other") {
      const f = at == null && (w === "break" || isBreak) ? startFor(person!, w) : from;
      setFrom(f);
      setUntil(defaultEnd(person!, f, w));
    }
  }

  function patchStep(i: number, patch: Partial<ChainStep>) {
    setChain((cur) => cur.map((st, k) => (k === i ? { ...st, ...patch } : st)));
  }

  function addStep() {
    const first = chainInfo.tailPos ? peopleAt(day, settings, chainInfo.tailPos, from, chainInfo.skip)[0] : undefined;
    setChain([...chain, { who: first?.id ?? "", where: "", from: null, until: null }]);
    setOpen(chain.length + 1);
  }

  function confirmChain() {
    if (!chainMoves) return;
    mutate((d) => applyChain(d, settings, from, chainMoves), { auto: true });
    const label0 = (m: ChainMove) =>
      `${day.shifts.find((x) => x.id === m.shiftId)?.name ?? "?"} → ${m.dest === "other" ? m.label : m.dest === "break" ? "Break" : m.dest === "bumpout" ? "Bumpout" : POSITION_LABEL[m.dest]}`;
    flash(`${fmt(from)} · ${chainMoves.map(label0).join(", ")}`);
    onClose();
  }

  function confirm() {
    if (chain.length > 0) return confirmChain();
    if (!valid || !person || blocked) return;
    const name = label.trim();
    const chosen = crew.find((s) => s.id === effective);

    if (isBreak) {
      mutate(
        (d) => applyBreakChange(d, settings, (dd) => placeBreak(dd, person.id, from, until - from), effective ?? null),
        { auto: true },
      );
      flash(
        `${person.name} on break ${fmt(from)}–${fmt(until)}${chosen && position ? ` · ${chosen.name} covers ${POSITION_LABEL[position]}` : ""}`,
      );
      onClose();
      return;
    }

    mutate(
      (d) => {
        let next = assignRange(d, settings, person.id, from, until, where, name);
        if (chosen && position) next = assignRange(next, settings, chosen.id, from, until, position);
        return next;
      },
      { auto: true },
    );
    if (where === "other" && name) {
      const next = pushLabel(recent, name);
      setRecent(next);
      saveLabels(next);
    }
    const dest = where === "other" ? name : POSITION_LABEL[where as Position];
    flash(
      `${person.name} → ${dest} ${fmt(from)}–${fmt(until)}${chosen && position ? ` · ${chosen.name} covers ${POSITION_LABEL[position]}` : ""}`,
    );
    onClose();
  }

  // what the break log says about the break being placed
  const owed = breaksOwed(person);
  const kind = breakKind(until - from);
  const breakLength = until - from;
  const logNote = ((): { cls: string; text: string } | null => {
    if (!isBreak || !valid) return null;
    if (!onLog(breakLength))
      return { cls: "warn", text: `The log has 20 min or 30–60 min breaks. ${fmtDuration(breakLength)} is off the log.` };
    if (owed[kind].unplaced > 0) return null;
    if (owed[kind].placed > 0)
      return { cls: "", text: `${person.name}'s ${KIND_LABEL[kind]} break is already placed, so this moves it.` };
    return { cls: "warn", text: `${person.name}'s log has no ${KIND_LABEL[kind]} break left, so this counts as an extra break.` };
  })();
  // the time they asked for, if they asked
  const asked = person.breaks.filter((b) => b.start == null && b.preferred != null).sort((x, y) => x.preferred! - y.preferred!)[0]?.preferred;
  const owedText = (["short", "long"] as const)
    .filter((k) => owed[k].unplaced + owed[k].placed > 0)
    .map((k) => `${KIND_LABEL[k]} × ${owed[k].unplaced + owed[k].placed}`)
    .join(" · ");

  const durations: { label: string; end: number; hint?: string }[] = isBreak
    ? [20, 30, 45, 60].map((m) => ({
        label: `${m} min`,
        end: from + m,
        hint: owed[breakKind(m)].unplaced > 0 ? "due" : undefined,
      }))
    : [
        { label: "30 min", end: from + 30 },
        { label: "1 hr", end: from + 60 },
        { label: "2 hr", end: from + 120 },
        { label: "Until bumpout", end: person.end },
      ];

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal card assign" role="dialog" aria-modal="true" aria-label="Assign" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 10 }}>Assign</h2>

        <div hidden={chain.length > 0 && open !== 0}>
        <div className="stack">
          <label className="lbl">
            <span className="step-head"><span className="step">1</span>Who are you moving?</span>
            <select className="field" value={who} onChange={(e) => changeWho(e.target.value)}>
              {crew.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({fmt(s.start)}–{fmt(s.end)})
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="step-head">
              <span className="step">2</span>Where to?
            </div>
            <div className="where-grid" role="group" aria-label="Where">
              {WHERE.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`brush ${w.cls}`}
                  aria-pressed={where === w.id}
                  onClick={() => changeWhere(w.id)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {where === "other" && (
            <div>
              <input
                className="field"
                style={{ width: "100%", borderColor: "var(--other)" }}
                value={label}
                maxLength={24}
                placeholder="Type where, e.g. Tournament"
                aria-label="Custom position name"
                autoFocus
                onChange={(e) => setLabel(e.target.value)}
              />
              {recent.length > 0 && (
                <div className="chip-row" style={{ marginTop: 8 }}>
                  {recent.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="btn small"
                      aria-pressed={label.trim().toLowerCase() === r.toLowerCase()}
                      onClick={() => setLabel(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {isBreak && asked != null && (
            <div className="chip-row">
              <button type="button" className="btn small" aria-pressed={from === asked} onClick={() => changeFrom(asked)}>
                Asked for {fmt(asked)}
              </button>
            </div>
          )}

          <div className="step-head" style={{ marginBottom: -4 }}>
            <span className="step">3</span>
            {isBreak ? "When and how long?" : "For how long?"}
            {!isBreak && <small className="opt">optional</small>}
          </div>
          <div className="two">
            <label className="lbl">
              From
              <TimeSelect
                value={from}
                min={person.start}
                max={person.end - g}
                label="From"
                onChange={(m) => m != null && changeFrom(m)}
              />
            </label>
            <label className="lbl">
              Until
              <TimeSelect
                value={until}
                min={from + g}
                max={person.end}
                label="Until"
                onChange={(m) => m != null && setUntil(m)}
              />
            </label>
          </div>
          <div className="chip-row">
            {durations.map((d, i) => {
              const end = Math.min(d.end, person.end);
              // only one chip lights up: "Until bumpout" when that is the chosen time, else the first that matches
              const toEnd = until === person.end;
              const active = d.label === "Until bumpout" ? toEnd : !toEnd && until === end && durations.findIndex((x) => Math.min(x.end, person.end) === end) === i;
              return (
                <button key={d.label} type="button" className="btn small" aria-pressed={active} onClick={() => setUntil(end)}>
                  {d.label}
                  {d.hint && <small className="chip-hint">{d.hint}</small>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="impact" aria-live="polite">
          {until <= from && <div className="note bad">Until needs to be after From.</div>}
          {until > from && targetCells.length === 0 && <div className="note bad">{person.name} is not working then.</div>}
          {valid && (
            <div className="note">
              {person.name} → <b>{isBreak ? "Break" : where === "other" ? label.trim() : POSITION_LABEL[where as Position]}</b>,{" "}
              {fmt(from)}–{fmt(until)} ({fmtDuration(until - from)})
            </div>
          )}
          {isBreak && person && (
            <div className="muted log-line">
              Break log: {owedText ? `still owed ${owedText}` : "all of this person's breaks are taken"}
            </div>
          )}
          {logNote && <div className={`note ${logNote.cls}`}>{logNote.text}</div>}
          {valid && position && (
            <div className={`note ${needsCover ? (impact?.remaining === 0 ? "bad" : "warn") : ""}`}>
              {needsCover
                ? impact?.remaining === 0
                  ? `${POSITION_LABEL[position]} would be empty.`
                  : `${POSITION_LABEL[position]} would drop to ${impact?.remaining} (needs ${impact?.min}).`
                : `${POSITION_LABEL[position]} keeps ${impact?.remaining} without ${person.name}.`}
            </div>
          )}
          {valid && !isBreak && where !== "other" && impact?.joined != null && impact.joined > settings.limits[where as Position].max && (
            <div className="note warn">
              {POSITION_LABEL[where as Position]} would have {impact.joined} (max {settings.limits[where as Position].max}).
            </div>
          )}
        </div>

        </div>

        {chain.length > 0 && (
          <div className="chain">
            {open !== 0 && (
              <button type="button" className="chain-sum" onClick={() => setOpen(0)}>
                <span className="step">1</span>
                <span>
                  {person.name} → {isBreak ? "Break" : where === "other" ? label.trim() || "Custom" : POSITION_LABEL[where as Position]}
                </span>
                <small>edit</small>
              </button>
            )}
            {chainInfo.rows.map((r, i) => {
              const n = i + 2;
              const sh = r.cands.find((c) => c.id === r.step.who);
              if (open !== i + 1) {
                return (
                  <div className="chain-sum" key={i}>
                    <span className="step">{n}</span>
                    <span>
                      {sh?.name ?? "?"} → {chainDest(r.step.where)}
                    </span>
                    <button type="button" className="btn ghost small" onClick={() => setOpen(i + 1)}>
                      edit
                    </button>
                    {i === chain.length - 1 && (
                      <button
                        type="button"
                        className="btn ghost small"
                        aria-label="Remove this step"
                        onClick={() => {
                          setChain(chain.slice(0, -1));
                          setOpen(0);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              }
              return (
                <div className="chain-step" key={i}>
                  <div className="step-head">
                    <span className="step">{n}</span>
                    Who at {r.prev ? POSITION_LABEL[r.prev] : "that spot"} is moving?
                  </div>
                  {r.cands.length > 0 ? (
                    <select className="field" value={r.step.who} aria-label="Who is moving" onChange={(e) => patchStep(i, { who: e.target.value })}>
                      <option value="">Pick someone</option>
                      {r.cands.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="muted">No one to move from {r.prev ? POSITION_LABEL[r.prev] : "that spot"} at {fmt(from)}.</div>
                  )}
                  <div className="step-head">Where are they going?</div>
                  <div className="where-grid" role="group" aria-label="Where they are going">
                    {CHAIN_WHERE.filter((w) => w.id !== r.prev).map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className={`brush ${w.cls}`}
                        aria-pressed={r.step.where === w.id}
                        onClick={() => patchStep(i, { where: w.id, from: null, until: w.id === "break" ? from + (sh ? breakLen(sh) : 20) : null })}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                  {r.step.where !== "" && r.step.where !== "bumpout" && sh && (() => {
                    const brk = r.step.where === "break";
                    const stFrom = r.step.from ?? from;
                    const stUntil = r.step.until ?? sh.end;
                    const chips = brk
                      ? [20, 30, 45, 60].map((m) => ({ label: `${m} min`, until: stFrom + m }))
                      : [
                          { label: "Until bumpout", until: null as number | null },
                          { label: "30 min", until: Math.min(stFrom + 30, sh.end) },
                          { label: "1 hr", until: Math.min(stFrom + 60, sh.end) },
                          { label: "2 hr", until: Math.min(stFrom + 120, sh.end) },
                        ];
                    return (
                      <>
                        <div className="two">
                          <label className="lbl">
                            {brk ? "Break starts" : "From"}
                            <TimeSelect
                              value={stFrom}
                              min={sh.start}
                              max={sh.end - g}
                              label="From"
                              onChange={(m) => {
                                if (m == null) return;
                                // moving the start moves a break's end with it so its length stays the same
                                patchStep(i, { from: m, until: r.step.until == null ? null : r.step.until + (m - stFrom) });
                              }}
                            />
                          </label>
                          <label className="lbl">
                            {brk ? "Break ends" : "Until"}
                            <TimeSelect
                              value={stUntil}
                              min={stFrom + g}
                              max={sh.end}
                              label="Until"
                              onChange={(m) => m != null && patchStep(i, { until: !brk && m >= sh.end ? null : m })}
                            />
                          </label>
                        </div>
                        <div className="chip-row">
                          {chips.map((c) => {
                            const on = c.until == null ? r.step.until == null : r.step.until === c.until || (r.step.until == null && c.until === sh.end);
                            return (
                              <button key={c.label} type="button" className="btn small" aria-pressed={on} onClick={() => patchStep(i, { until: c.until })}>
                                {c.label}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              );
            })}
            {chainAfter && (
              <div className="chain-counts" aria-label="Headcount afterwards">
                {(["front", "bar", "dungeon"] as Position[]).map((p) => {
                  const { min, max } = settings.limits[p];
                  const c = chainAfter.counts[p];
                  const tone = c < min ? (c === 0 ? "bad" : "warn") : c > max ? "warn" : "ok";
                  return (
                    <span key={p} className={`chain-count ${tone}`}>
                      {POSITION_LABEL[p]} <b>{c}</b>
                    </span>
                  );
                })}
                {chainAfter.away > 0 && (
                  <span className="chain-count ok">
                    On break <b>{chainAfter.away}</b>
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {valid && chainInfo.tailPos && chain.every((st) => st.who && st.where) && peopleAt(day, settings, chainInfo.tailPos, from, chainInfo.skip).length > 0 && (
          <button type="button" className="btn add-rot" onClick={addStep}>
            + Add rotation
          </button>
        )}

        {showPicker && chain.length === 0 && impact && position && (
          <div style={{ marginTop: 14 }}>
            <CoverPicker
              position={position}
              options={impact.options}
              remaining={impact.remaining}
              min={impact.min}
              choice={effective}
              onChoose={setCoverChoice}
            />
          </div>
        )}

        <div className="assign-foot">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm} disabled={chain.length > 0 ? !chainMoves : !valid || blocked}>
            {chain.length > 0 ? `Assign ${chain.length + 1} moves` : isBreak ? "Send on break" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}
