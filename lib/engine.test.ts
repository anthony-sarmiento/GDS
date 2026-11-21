import { describe, expect, it } from "vitest";
import { planBreaks, requiredBreaks } from "./breaks";
import { autoFill, breakAtCell, breakImpact, cellKey, cellsFor, isPresent, positionMinutes, staffAt } from "./rotation";
import { addShift, assignRange, bumpOut, emptyDay, eraseCells, initialState, paintCells, placeBreak, refresh } from "./store";
import { analyzeCover, applyBreakChange, assignCover, suggestMover } from "./cover";
import { DayState, DEFAULT_SETTINGS, Position, roleName } from "./types";

const h = (hr: number, m = 0) => hr * 60 + m;
const S = DEFAULT_SETTINGS;

function typicalDay(): DayState {
  let day = emptyDay("2026-11-17");
  const add = (name: string, s: number, e: number, extra = {}) => {
    day = addShift(day, { name, start: s, end: e, lock: null, floater: false, ...extra });
  };
  add("Lead", h(10), h(17, 15), { role: "opening" });
  add("Alex", h(11), h(17));
  add("Bri", h(11), h(17));
  add("Cam", h(11), h(17));
  add("Flo", h(13), h(21), { floater: true });
  add("Dee", h(17), h(23));
  add("Eli", h(17), h(23));
  add("Fay", h(17), h(23));
  // GDS no longer plans breaks by itself; these tests exercise the planner directly
  const planned = planBreaks(refresh(day, initialState()), S);
  return assignedBoard(planned);
}

/** What the lead does before people arrive: give each one a starting position for the rest of their shift. */
function assignedBoard(day: DayState): DayState {
  const start: Record<string, Position> = { Alex: "front", Bri: "bar", Cam: "dungeon", Flo: "bar", Dee: "front", Eli: "bar", Fay: "dungeon" };
  let d = day;
  for (const s of day.shifts) {
    const p = start[s.name];
    if (p) d = assignRange(d, S, s.id, s.start, s.end, p);
  }
  return { ...d, cells: autoFill(d, S) };
}

/** The typical day with every break taken off the board, to test positions on their own. */
function quietDay(): DayState {
  const d = typicalDay();
  const stripped = { ...d, shifts: d.shifts.map((s) => ({ ...s, breaks: s.breaks.map((b) => ({ ...b, planned: null })) })) };
  return { ...stripped, cells: autoFill(stripped, S) };
}

describe("nobody is given a position until the lead assigns it", () => {
  const team = () => {
    let day = emptyDay("2026-11-17");
    for (const n of ["A", "B", "C", "D", "E"]) day = addShift(day, { name: n, start: h(11), end: h(17), lock: null, floater: false });
    return day;
  };

  it("adding people leaves every column empty", () => {
    const day = refresh(team(), initialState());
    expect(Object.keys(day.cells)).toHaveLength(0);
    for (const c of cellsFor(day.shifts, S)) {
      const by = staffAt(day, S, c);
      expect(by.front.length + by.bar.length + by.dungeon.length).toBe(0);
    }
  });

  it("forgets positions an older version dealt out on its own", () => {
    const day = team();
    const old = { ...day, cells: { [cellKey(day.shifts[0].id, h(12))]: { pos: "bar" as const, pinned: false } } };
    expect(autoFill(old, S)).toEqual({});
  });

  it("a starting position stays until the lead moves the person", () => {
    let day = team();
    const a = day.shifts[0];
    day = assignRange(day, S, a.id, h(11), h(12), "front");
    day = refresh(day, initialState());
    for (const t of [h(11), h(11, 55), h(12), h(14), h(16, 55)]) expect(day.cells[cellKey(a.id, t)]?.pos).toBe("front");
    // only the first hour was assigned; the rest is carried on
    expect(day.cells[cellKey(a.id, h(11, 30))]?.pinned).toBe(true);
    expect(day.cells[cellKey(a.id, h(14))]?.pinned).toBe(false);
    // somebody else was never assigned, so they stay empty
    expect(day.cells[cellKey(day.shifts[1].id, h(14))]).toBeUndefined();
  });

  it("moving someone later carries the new position forward", () => {
    let day = team();
    const a = day.shifts[0];
    day = assignRange(day, S, a.id, h(11), h(13), "front");
    day = assignRange(day, S, a.id, h(13), h(14), "bar");
    day = refresh(day, initialState());
    expect(day.cells[cellKey(a.id, h(12, 55))]?.pos).toBe("front");
    expect(day.cells[cellKey(a.id, h(13))]?.pos).toBe("bar");
    expect(day.cells[cellKey(a.id, h(15))]?.pos).toBe("bar");
  });

  it("a custom spot is temporary: afterwards they go back to where they were", () => {
    let day = team();
    const a = day.shifts[0];
    day = assignRange(day, S, a.id, h(11), h(13), "dungeon");
    day = assignRange(day, S, a.id, h(13), h(14), "other", "Tournament");
    day = refresh(day, initialState());
    expect(day.cells[cellKey(a.id, h(13, 30))]?.pos).toBe("other");
    expect(day.cells[cellKey(a.id, h(14, 5))]).toEqual({ pos: "dungeon", pinned: false });
  });

  it("someone who covers a break goes back to their own position afterwards", () => {
    let day = team();
    const [a, b] = day.shifts;
    day = assignRange(day, S, a.id, h(11), h(12), "dungeon");
    day = assignRange(day, S, b.id, h(11), h(12), "front");
    day = placeBreak(day, a.id, h(11, 30), 20).day;
    const brk = day.shifts[0].breaks[0];
    day = assignCover(day, S, a.id, brk.id, b.id).day;
    day = refresh(day, initialState());
    expect(day.cells[cellKey(b.id, h(11, 35))]).toMatchObject({ pos: "dungeon", cover: brk.id });
    expect(day.cells[cellKey(b.id, h(11, 50))]?.pos).toBe("front");
    expect(day.cells[cellKey(b.id, h(13))]?.pos).toBe("front");
  });

  it("someone set to stay at a position is there without being assigned", () => {
    let day = emptyDay("2026-11-17");
    day = addShift(day, { name: "Stan", start: h(11), end: h(17), lock: "dungeon", floater: false });
    day = refresh(day, initialState());
    expect(day.cells[cellKey(day.shifts[0].id, h(12))]?.pos).toBe("dungeon");
  });
});

describe("break rules (from the paper log)", () => {
  it("matches the break log table", () => {
    expect(requiredBreaks(6.98)).toEqual([20]);
    expect(requiredBreaks(6)).toEqual([20]);
    expect(requiredBreaks(7.25)).toEqual([30]);
    expect(requiredBreaks(9)).toEqual([20, 30]);
    expect(requiredBreaks(12)).toEqual([20, 20, 30]);
  });
});

describe("breaks are never recommended on the board", () => {
  it("adding people and re-dealing leaves every break unscheduled", () => {
    let day = emptyDay("2026-11-17");
    for (const n of ["A", "B", "C", "D", "E"]) day = addShift(day, { name: n, start: h(11), end: h(17), lock: null, floater: false });
    day = refresh(day, initialState());
    for (const s of day.shifts) for (const b of s.breaks) expect(b.planned).toBeNull();
  });

  it("only shows a break once the lead places one", () => {
    let day = refresh(addShift(emptyDay("2026-11-17"), { name: "A", start: h(11), end: h(17), lock: null, floater: false }), initialState());
    const a = day.shifts[0];
    expect(a.breaks[0].planned).toBeNull();
    day = placeBreak(day, a.id, h(14), 20).day;
    expect(day.shifts[0].breaks[0].planned).toBe(h(14));
  });
});

describe("break planning", () => {
  it("places every break inside its shift, one person out at a time", () => {
    const day = typicalDay();
    for (const s of day.shifts) {
      for (const b of s.breaks) {
        expect(b.planned).not.toBeNull();
        expect(b.planned!).toBeGreaterThanOrEqual(s.start);
        expect(b.planned! + b.length).toBeLessThanOrEqual(s.end);
      }
    }
    const spans = day.shifts.filter((s) => !s.role).flatMap((s) => s.breaks.map((b) => [b.planned!, b.planned! + b.length]));
    for (let t = h(10); t < h(23); t += 5) {
      expect(spans.filter(([a, b]) => a <= t && t < b).length).toBeLessThanOrEqual(1);
    }
  });

  it("keeps floor breaks out of the thin morning before the floater arrives", () => {
    const day = typicalDay();
    const openers = day.shifts.filter((s) => s.start < h(13) && !s.role);
    for (const s of openers) expect(s.breaks[0].planned!).toBeGreaterThanOrEqual(h(13));
  });

  it("does not make leads wait their turn: a lead break is exempt from the one-at-a-time rule", () => {
    const day = typicalDay();
    const lead = day.shifts.find((s) => s.role)!;
    expect(lead.breaks[0].planned).not.toBeNull();
  });
});

describe("staffing follows what was assigned", () => {
  it("counts exactly the people the lead put on each position", () => {
    const day = quietDay();
    const by = staffAt(day, S, h(14)); // Alex Front, Bri + Flo Bar, Cam Dungeon
    expect(by.front.map((x) => x.name)).toEqual(["Alex"]);
    expect(by.bar.map((x) => x.name).sort()).toEqual(["Bri", "Flo"]);
    expect(by.dungeon.map((x) => x.name)).toEqual(["Cam"]);
  });

  it("shows a position as short until somebody is assigned to it", () => {
    const day = quietDay();
    expect(staffAt(day, S, h(11, 30)).bar.map((x) => x.name)).toEqual(["Bri"]); // Flo is not in yet
  });
});

describe("freeform painting", () => {
  it("never moves painted columns when the board is re-dealt", () => {
    let day = typicalDay();
    const alex = day.shifts[1];
    day = paintCells(day, alex.id, [h(12), h(12, 30)], "dungeon");
    const again = autoFill(day, S);
    expect(again[cellKey(alex.id, h(12))]).toEqual({ pos: "dungeon", pinned: true });
    expect(again[cellKey(alex.id, h(12, 30))]).toEqual({ pos: "dungeon", pinned: true });
  });

  it("paints a break onto the board and erases it again", () => {
    let day = typicalDay();
    const dee = day.shifts.find((s) => s.name === "Dee")!;
    day = placeBreak(day, dee.id, h(20), null).day;
    const placed = day.shifts.find((s) => s.id === dee.id)!;
    expect(placed.breaks.some((b) => b.planned === h(20) && b.locked)).toBe(true);
    expect(breakAtCell(placed, h(20), S.gridMinutes)).toBeDefined();

    day = eraseCells(day, S, dee.id, [h(20)]);
    const cleared = day.shifts.find((s) => s.id === dee.id)!;
    expect(breakAtCell(cleared, h(20), S.gridMinutes)).toBeUndefined();
  });

  it("takes people on break off the position count", () => {
    let day = typicalDay();
    const alex = day.shifts[1];
    day = placeBreak(day, alex.id, h(14), null).day;
    const c = h(14);
    const by = staffAt(day, S, c);
    expect([...by.front, ...by.bar, ...by.dungeon].some((s) => s.id === alex.id)).toBe(false);
    expect(breakImpact(day, S, alex, c).position).not.toBeNull();
  });
});

describe("leads", () => {
  it("are not on the board, so they never count toward a position", () => {
    const day = typicalDay();
    const lead = day.shifts.find((s) => s.role)!;
    expect(Object.keys(day.cells).some((k) => k.startsWith(`${lead.id}@`))).toBe(false);
    // 11:30 -> 3 openers: Front 1, Bar 2, Dungeon 1 would need 4; only the 3 openers are on
    const by = staffAt(day, S, h(11, 30));
    expect(by.front.length + by.bar.length + by.dungeon.length).toBe(3);
  });
});

describe("break cover", () => {
  it("never leaves a position empty while its holder is on break", () => {
    let day = quietDay();
    for (const name of ["Alex", "Bri", "Cam"]) {
      const who = day.shifts.find((s) => s.name === name)!;
      const placed = placeBreak(day, who.id, h(14), 20);
      const res = assignCover(placed.day, S, who.id, placed.breakId!);
      expect(res.status).not.toBe("uncovered");
      day = res.day;
      const c = h(14, 5);
      const pos = day.cells[cellKey(who.id, c)].pos as Position;
      expect(staffAt(day, S, c)[pos].length).toBeGreaterThanOrEqual(1);
      // reset for the next person
      day = eraseCells(day, S, who.id, [h(14), h(14, 5), h(14, 10), h(14, 15)]);
      day = { ...day, cells: autoFill(day, S) };
    }
  });

  it("uses the floater first when they can be spared", () => {
    let day = emptyDay("2026-11-17");
    for (const n of ["A", "B", "C", "D"]) day = addShift(day, { name: n, start: h(11), end: h(17), lock: null, floater: false });
    day = addShift(day, { name: "Flo", start: h(11), end: h(17), lock: null, floater: true });
    const spots: Position[] = ["front", "bar", "bar", "dungeon", "bar"];
    day.shifts.forEach((s, i) => (day = assignRange(day, S, s.id, s.start, s.end, spots[i])));
    day = refresh(day, initialState());
    const a = day.shifts[0];
    const placed = placeBreak(day, a.id, h(13), 20);
    const res = assignCover(placed.day, S, a.id, placed.breakId!);
    expect(res.status === "covered" || res.status === "none-needed").toBe(true);
  });

  it("says so when nobody can cover", () => {
    // two people on Front and Bar: a break empties a position and the other person cannot move
    let day = emptyDay("2026-11-17");
    for (const n of ["A", "B"]) day = addShift(day, { name: n, start: h(11), end: h(17), lock: null, floater: false });
    day = assignRange(day, S, day.shifts[0].id, h(11), h(17), "front");
    day = assignRange(day, S, day.shifts[1].id, h(11), h(17), "bar");
    day = refresh(day, initialState());
    const a = day.shifts[0];
    const placed = placeBreak(day, a.id, h(13), 20);
    const res = assignCover(placed.day, S, a.id, placed.breakId!);
    expect(res.status).toBe("uncovered");
  });

  it("removes the cover blocks when the break is erased", () => {
    let day = quietDay();
    const alex = day.shifts.find((s) => s.name === "Alex")!;
    const placed = placeBreak(day, alex.id, h(14), 20);
    day = assignCover(placed.day, S, alex.id, placed.breakId!).day;
    day = eraseCells(day, S, alex.id, [h(14), h(14, 5), h(14, 10), h(14, 15)]);
    expect(Object.values(day.cells).some((c) => c.cover === placed.breakId)).toBe(false);
  });
});

describe("no automatic cover", () => {
  it("does not move anyone over by itself when a break is on the board", () => {
    const day = quietDay();
    const c = h(14);
    const holder = day.shifts.find((s) => !s.role && day.cells[cellKey(s.id, c)]?.pos === "dungeon" && s.start <= c && c < s.end)!;
    const placed = placeBreak(day, holder.id, c, 20);
    // rebuild the board with the break in place
    const redealt = { ...placed.day, cells: autoFill(placed.day, S) };
    const at = (t: number) => staffAt(redealt, S, t);
    // the holder is on break, nobody was sent to cover: the position is open until the lead picks someone
    const during = at(h(14, 5));
    const everyone = during.front.length + during.bar.length + during.dungeon.length;
    expect(everyone).toBeGreaterThan(0);
    expect(during.dungeon.some((s) => s.id === holder.id)).toBe(false);
    expect(Object.values(redealt.cells).some((cell) => cell.cover)).toBe(false);
    // and everyone else stays put for the rest of that rotation block instead of shuffling to cover
    for (const s of redealt.shifts.filter((x) => !x.role && x.id !== holder.id && x.start <= h(14, 5) && h(14, 30) < x.end)) {
      expect(redealt.cells[cellKey(s.id, h(14, 5))].pos).toBe(redealt.cells[cellKey(s.id, h(14, 30))].pos);
    }
  });
});

describe("sending someone on break with the cover you picked", () => {
  it("puts the chosen person on the position and keeps them there after the board fills in", () => {
    const day = quietDay();
    const c = h(14);
    const holder = day.shifts.find((s) => !s.role && day.cells[cellKey(s.id, c)]?.pos === "dungeon" && s.start <= c && c < s.end)!;
    const probe = placeBreak(day, holder.id, c, 20);
    const a = analyzeCover(probe.day, S, holder.id, probe.breakId!);
    const picked = a.options.find((o) => !o.recommended)!; // not GDS's suggestion: the lead's own choice

    // the same steps the Assign dialog and the break timer run
    let next = applyBreakChange(day, S, (d) => placeBreak(d, holder.id, c, 20), picked.shift.id);
    next = { ...next, cells: autoFill(next, S) }; // the pass that follows in the app

    for (const t of [h(14), h(14, 10), h(14, 15)]) {
      expect(next.cells[cellKey(picked.shift.id, t)]).toMatchObject({ pos: "dungeon", pinned: true });
      expect(staffAt(next, S, t).dungeon.map((s) => s.id)).toEqual([picked.shift.id]);
    }
    // and it ends when the break does
    expect(next.cells[cellKey(picked.shift.id, h(14, 20))]?.cover).toBeUndefined();
  });

  it("does the same when the break is moved to a new time", () => {
    const day = quietDay();
    const holder = day.shifts.find((s) => !s.role && day.cells[cellKey(s.id, h(13, 30))]?.pos === "dungeon" && s.start <= h(13, 30))!;
    const first = applyBreakChange(day, S, (d) => placeBreak(d, holder.id, h(13, 30), 20), null);
    const probe = placeBreak(first, holder.id, h(14), 20);
    const a = analyzeCover(probe.day, S, holder.id, probe.breakId!);
    const picked = a.options[0];
    const moved = applyBreakChange(first, S, (d) => placeBreak(d, holder.id, h(14), 20), picked.shift.id);
    // the holder rotates at 2:00, so the position to cover is whatever they hold at the new time
    expect(a.position).not.toBeNull();
    expect(moved.cells[cellKey(picked.shift.id, h(14, 5))]).toMatchObject({ pos: a.position, pinned: true });
    // the cover at the old time is gone
    expect(Object.values(moved.cells).filter((c) => c.cover).length).toBeGreaterThan(0);
    expect(moved.cells[cellKey(picked.shift.id, h(13, 35))]?.cover).toBeUndefined();
  });
});

describe("choosing who covers", () => {
  function withBreak() {
    const day = quietDay();
    const c = h(14);
    // a person who is the only one on the Dungeon, so their break needs a cover
    const holder = day.shifts.find((s) => !s.role && day.cells[cellKey(s.id, c)]?.pos === "dungeon" && s.start <= c && c < s.end)!;
    const placed = placeBreak(day, holder.id, c, 20);
    return { day: placed.day, holder, breakId: placed.breakId! };
  }

  it("lists everyone who could rotate over and says what it costs", () => {
    const { day, holder, breakId } = withBreak();
    const a = analyzeCover(day, S, holder.id, breakId);
    expect(a.position).toBe("dungeon");
    expect(a.needs).toBe(true);
    expect(a.options.length).toBeGreaterThan(0);
    expect(a.options.filter((o) => o.recommended)).toHaveLength(1);
    expect(a.options[0].recommended).toBe(true);
    for (const o of a.options) expect(o.shift.id).not.toBe(holder.id);
  });

  it("puts the person you picked on the position, not GDS's pick", () => {
    const { day, holder, breakId } = withBreak();
    const a = analyzeCover(day, S, holder.id, breakId);
    const other = a.options.find((o) => !o.recommended)!;
    const res = assignCover(day, S, holder.id, breakId, other.shift.id);
    expect(res.status).toBe("covered");
    expect(res.cover!.id).toBe(other.shift.id);
    expect(res.day.cells[cellKey(other.shift.id, h(14, 5))]).toMatchObject({ pos: "dungeon", pinned: true, cover: breakId });
  });

  it("covers nobody when you say nobody", () => {
    const { day, holder, breakId } = withBreak();
    const res = assignCover(day, S, holder.id, breakId, null);
    expect(res.cover).toBeNull();
    expect(["short", "uncovered"]).toContain(res.status);
    expect(Object.values(res.day.cells).some((c) => c.cover === breakId)).toBe(false);
  });

  it("does not need a cover for a lead, who has no position", () => {
    const day = typicalDay();
    const lead = day.shifts.find((s) => s.role)!;
    const placed = placeBreak(day, lead.id, h(13), 30);
    const a = analyzeCover(placed.day, S, lead.id, placed.breakId!);
    expect(a.position).toBeNull();
    expect(a.options).toHaveLength(0);
  });
});

describe("pushed assignments", () => {
  it("sends someone somewhere for exactly the time given and leaves the rest of their day", () => {
    let day = quietDay();
    const cam = day.shifts.find((s) => s.name === "Cam")!;
    const before = { ...day.cells };
    day = assignRange(day, S, cam.id, h(14, 15), h(15, 5), "bar");
    for (const t of [h(14, 15), h(14, 30), h(15)]) expect(day.cells[cellKey(cam.id, t)]).toEqual({ pos: "bar", pinned: true });
    expect(day.cells[cellKey(cam.id, h(14, 10))]).toEqual(before[cellKey(cam.id, h(14, 10))]);
    expect(day.cells[cellKey(cam.id, h(15, 5))]).toEqual(before[cellKey(cam.id, h(15, 5))]);
  });

  it("can send someone to a named custom spot", () => {
    let day = quietDay();
    const bri = day.shifts.find((s) => s.name === "Bri")!;
    day = assignRange(day, S, bri.id, h(14), h(15), "other", "Tournament");
    expect(day.cells[cellKey(bri.id, h(14, 30))]).toEqual({ pos: "other", pinned: true, label: "Tournament" });
  });

  it("does nothing for an empty or backwards range, or outside their shift", () => {
    const day = quietDay();
    const cam = day.shifts.find((s) => s.name === "Cam")!;
    expect(assignRange(day, S, cam.id, h(14), h(14), "bar")).toBe(day);
    expect(assignRange(day, S, cam.id, h(20), h(21), "bar").cells).toEqual(day.cells);
  });

  it("suggests someone to cover the position that was left", () => {
    let day = quietDay();
    const c = h(14);
    const holder = day.shifts.find((s) => !s.role && day.cells[cellKey(s.id, c)]?.pos === "dungeon" && s.start <= c && c < s.end)!;
    // send the Dungeon holder to a custom spot: Dungeon is left empty
    const draft = assignRange(day, S, holder.id, h(14), h(15), "other", "Tournament");
    const mover = suggestMover(draft, S, "dungeon", c, holder.id, [c]);
    expect(mover).not.toBeNull();
    expect(mover!.shift.id).not.toBe(holder.id);
    day = draft;
  });
});

describe("custom assignment", () => {
  it("takes someone off the rotation and shows the typed name", () => {
    let day = typicalDay();
    day = addShift(day, { name: "Quinn", start: h(11), end: h(17), lock: null, floater: false, role: "custom", roleLabel: "  Events " });
    day = refresh(day, initialState());
    const quinn = day.shifts.find((s) => s.name === "Quinn")!;
    expect(roleName(quinn)).toBe("Events");
    expect(Object.keys(day.cells).some((k) => k.startsWith(`${quinn.id}@`))).toBe(false);
    expect(quinn.breaks.length).toBeGreaterThan(0);
  });

  it("falls back to Custom when no name was typed", () => {
    expect(roleName({ role: "custom" })).toBe("Custom");
    expect(roleName({ role: "opening" })).toBe("Opening Lead");
    expect(roleName({ role: null })).toBe("");
  });
});

describe("custom positions", () => {
  it("keeps the typed name and survives a re-deal", () => {
    let day = quietDay();
    const bri = day.shifts.find((s) => s.name === "Bri")!;
    day = paintCells(day, bri.id, [h(15), h(15, 5), h(15, 10)], "other", "  Tournament ");
    expect(day.cells[cellKey(bri.id, h(15))]).toEqual({ pos: "other", pinned: true, label: "Tournament" });
    const again = autoFill(day, S);
    expect(again[cellKey(bri.id, h(15, 10))].label).toBe("Tournament");
  });

  it("is not counted toward Front, Bar or Dungeon", () => {
    let day = quietDay();
    const c = h(15);
    const before = staffAt(day, S, c);
    const total = before.front.length + before.bar.length + before.dungeon.length;
    const bri = day.shifts.find((s) => s.name === "Bri")!;
    day = paintCells(day, bri.id, [c], "other", "Photo booth");
    const after = staffAt(day, S, c);
    expect(after.front.length + after.bar.length + after.dungeon.length).toBe(total - 1);
  });

  it("needs no cover when its holder takes a break", () => {
    let day = quietDay();
    const bri = day.shifts.find((s) => s.name === "Bri")!;
    day = paintCells(day, bri.id, [h(15), h(15, 5), h(15, 10), h(15, 15)], "other", "Tournament");
    const placed = placeBreak(day, bri.id, h(15), 20);
    const res = assignCover(placed.day, S, bri.id, placed.breakId!);
    expect(res.status).toBe("none-needed");
  });
});

describe("edges of a shift", () => {
  it("keeps a break inside the shift when it is dropped at the edge", () => {
    const day = quietDay();
    const alex = day.shifts.find((s) => s.name === "Alex")!; // 11:00 - 5:00
    const late = placeBreak(day, alex.id, h(16, 55), 20).day.shifts.find((s) => s.id === alex.id)!;
    const b = late.breaks.find((x) => x.planned != null)!;
    expect(b.planned! + b.length).toBeLessThanOrEqual(alex.end);
    const early = placeBreak(day, alex.id, h(10, 30), null).day.shifts.find((s) => s.id === alex.id)!;
    expect(early.breaks.find((x) => x.planned != null)!.planned).toBeGreaterThanOrEqual(alex.start);
  });

  it("only paints the columns the person is working", () => {
    let day = quietDay();
    const dee = day.shifts.find((s) => s.name === "Dee")!; // 5:00 PM start
    day = assignRange(day, S, dee.id, h(16, 30), h(17, 30), "bar");
    expect(day.cells[cellKey(dee.id, h(16, 30))]).toBeUndefined();
    expect(day.cells[cellKey(dee.id, h(17))]).toMatchObject({ pos: "bar", pinned: true });
  });
});

describe("precision", () => {
  it("places a 20 minute break on exact minutes", () => {
    let day = typicalDay();
    const bri = day.shifts.find((s) => s.name === "Bri")!;
    day = placeBreak(day, bri.id, h(15, 10), null).day;
    const b = day.shifts.find((s) => s.id === bri.id)!.breaks.find((x) => x.planned === h(15, 10))!;
    expect(b.length).toBe(20);
    expect(breakAtCell(day.shifts.find((s) => s.id === bri.id)!, h(15, 10), 5)).toBeDefined();
    expect(breakAtCell(day.shifts.find((s) => s.id === bri.id)!, h(15, 30), 5)).toBeUndefined();
  });
});

describe("bump out", () => {
  it("sends the person home and puts the new person on their position", () => {
    let day = typicalDay();
    const alex = day.shifts[1];
    const dee = day.shifts.find((s) => s.name === "Dee")!;
    const posBefore = day.cells[cellKey(alex.id, h(16, 30))].pos;

    day = bumpOut(day, S, alex.id, dee.id, h(16, 30));
    const out = day.shifts.find((s) => s.id === alex.id)!;
    expect(out.end).toBe(h(16, 30));
    expect(out.sentHomeAt).toBe(h(16, 30));
    expect(out.bumpedBy).toBe("Dee");
    expect(isPresent(out, h(17), S.gridMinutes)).toBe(false);
    // Dee clocks in at 5:00 and is pinned to the position Alex vacated
    expect(day.cells[cellKey(dee.id, h(17))]?.pinned).toBe(true);
    expect(posBefore).toBeDefined();
  });

  it("pins the replacement to the vacated position", () => {
    let day = typicalDay();
    const bri = day.shifts[2];
    const eli = day.shifts.find((s) => s.name === "Eli")!;
    const pos = day.cells[cellKey(bri.id, h(16, 55))].pos;
    day = bumpOut(day, S, bri.id, eli.id, h(17));
    expect(day.cells[cellKey(eli.id, h(17))]).toEqual({ pos, pinned: true });
  });
});
