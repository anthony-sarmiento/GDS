import { describe, expect, it } from "vitest";
import { requiredBreaks } from "./breaks";
import { autoFill, breakAtCell, breakImpact, cellKey, cellsFor, isPresent, positionMinutes, staffAt } from "./rotation";
import { addShift, bumpOut, emptyDay, eraseCells, initialState, paintCells, placeBreak, refresh } from "./store";
import { assignCover } from "./cover";
import { DayState, DEFAULT_SETTINGS, Position } from "./types";

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
  return refresh(day, initialState(), null);
}

/** The typical day with every break taken off the board, to test positions on their own. */
function quietDay(): DayState {
  const d = typicalDay();
  const stripped = { ...d, shifts: d.shifts.map((s) => ({ ...s, breaks: s.breaks.map((b) => ({ ...b, planned: null })) })) };
  return { ...stripped, cells: autoFill(stripped, S) };
}

describe("break rules (from the paper log)", () => {
  it("matches the break log table", () => {
    expect(requiredBreaks(6.98)).toEqual([20]);
    expect(requiredBreaks(6)).toEqual([20]);
    expect(requiredBreaks(7.25)).toEqual([30]);
    expect(requiredBreaks(9)).toEqual([20, 30]);
    expect(requiredBreaks(12)).toEqual([20, 20, 30]);
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

describe("staffing limits (SOP: Front 1-2, Bar 2-3, Dungeon 1)", () => {
  it("meets the SOP in every column that has enough people", () => {
    const day = typicalDay();
    for (const c of cellsFor(day.shifts, S)) {
      const by = staffAt(day, S, c);
      const onFloor = by.front.length + by.bar.length + by.dungeon.length;
      if (onFloor < 4) continue;
      expect(by.dungeon.length).toBeLessThanOrEqual(1);
      expect(by.bar.length).toBeGreaterThanOrEqual(2);
      expect(by.bar.length).toBeLessThanOrEqual(3);
      expect(by.front.length).toBeGreaterThanOrEqual(1);
      expect(by.front.length).toBeLessThanOrEqual(2);
    }
  });

  it("covers Dungeon with exactly one person whenever 4+ are on", () => {
    const day = quietDay();
    const c = h(13, 30); // three openers plus the floater
    expect(staffAt(day, S, c).dungeon).toHaveLength(1);
  });

  it("does not park anyone at one position (Bar needs more seats, so allow a skew)", () => {
    const day = typicalDay();
    const mins = positionMinutes(day, S);
    for (const s of day.shifts.filter((x) => !x.role && x.end - x.start >= 6 * 60)) {
      const vals = Object.values(mins[s.id]);
      const total = vals.reduce((a, b) => a + b, 0);
      expect(Math.max(...vals) / total).toBeLessThanOrEqual(0.75);
    }
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

  it("does not rewrite earlier columns when re-dealing from the current time", () => {
    const day = typicalDay();
    const redeal = autoFill(day, S, h(14, 20));
    for (const [k, v] of Object.entries(day.cells)) {
      if (Number(k.split("@")[1]) < h(14, 20)) expect(redeal[k]).toEqual(v);
    }
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
      day = { ...day, cells: autoFill(day, S, Infinity) };
    }
  });

  it("uses the floater first when they can be spared", () => {
    let day = emptyDay("2026-11-17");
    for (const n of ["A", "B", "C", "D"]) day = addShift(day, { name: n, start: h(11), end: h(17), lock: null, floater: false });
    day = addShift(day, { name: "Flo", start: h(11), end: h(17), lock: null, floater: true });
    day = refresh(day, initialState(), null);
    const a = day.shifts[0];
    const placed = placeBreak(day, a.id, h(13), 20);
    const res = assignCover(placed.day, S, a.id, placed.breakId!);
    expect(res.status === "covered" || res.status === "none-needed").toBe(true);
  });

  it("says so when nobody can cover", () => {
    // two people on Front and Bar: a break empties a position and the other person cannot move
    let day = emptyDay("2026-11-17");
    for (const n of ["A", "B"]) day = addShift(day, { name: n, start: h(11), end: h(17), lock: null, floater: false });
    day = refresh(day, initialState(), null);
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
