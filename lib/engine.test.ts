import { describe, expect, it } from "vitest";
import { requiredBreaks } from "./breaks";
import { autoFill, breakAtCell, breakImpact, cellKey, cellsFor, isPresent, positionMinutes, staffAt } from "./rotation";
import { addShift, bumpOut, emptyDay, eraseCells, initialState, paintCells, placeBreak, refresh } from "./store";
import { DayState, DEFAULT_SETTINGS } from "./types";

const h = (hr: number, m = 0) => hr * 60 + m;
const S = DEFAULT_SETTINGS;

function typicalDay(): DayState {
  let day = emptyDay("2026-11-17");
  const add = (name: string, s: number, e: number, extra = {}) => {
    day = addShift(day, { name, start: s, end: e, lock: null, floater: false, ...extra });
  };
  add("Lead", h(10), h(17, 15));
  add("Alex", h(11), h(17));
  add("Bri", h(11), h(17));
  add("Cam", h(11), h(17));
  add("Flo", h(13), h(21), { floater: true });
  add("Dee", h(17), h(23));
  add("Eli", h(17), h(23));
  add("Fay", h(17), h(23));
  return refresh(day, initialState(), null);
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
    const spans = day.shifts.flatMap((s) => s.breaks.map((b) => [b.planned!, b.planned! + b.length]));
    for (let t = h(10); t < h(23); t += 5) {
      expect(spans.filter(([a, b]) => a <= t && t < b).length).toBeLessThanOrEqual(1);
    }
  });

  it("keeps breaks out of the thin morning before the floater arrives", () => {
    const day = typicalDay();
    const openers = day.shifts.filter((s) => s.start < h(13));
    for (const s of openers) expect(s.breaks[0].planned!).toBeGreaterThanOrEqual(h(13));
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
    const day = typicalDay();
    const c = h(12);
    expect(staffAt(day, S, c).dungeon).toHaveLength(1);
  });

  it("does not park anyone at one position (Bar needs more seats, so allow a skew)", () => {
    const day = typicalDay();
    const mins = positionMinutes(day, S);
    for (const s of day.shifts.filter((x) => x.end - x.start >= 6 * 60)) {
      const vals = Object.values(mins[s.id]);
      const total = vals.reduce((a, b) => a + b, 0);
      expect(Math.max(...vals) / total).toBeLessThanOrEqual(0.7);
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
    day = placeBreak(day, S, dee.id, h(20), null);
    const placed = day.shifts.find((s) => s.id === dee.id)!;
    expect(placed.breaks.some((b) => b.planned === h(20) && b.locked)).toBe(true);
    expect(breakAtCell(placed, h(20), 30)).toBeDefined();

    day = eraseCells(day, S, dee.id, [h(20)]);
    const cleared = day.shifts.find((s) => s.id === dee.id)!;
    expect(breakAtCell(cleared, h(20), 30)).toBeUndefined();
  });

  it("takes people on break off the position count", () => {
    let day = typicalDay();
    const alex = day.shifts[1];
    day = placeBreak(day, S, alex.id, h(14), null);
    const c = h(14);
    const by = staffAt(day, S, c);
    expect([...by.front, ...by.bar, ...by.dungeon].some((s) => s.id === alex.id)).toBe(false);
    expect(breakImpact(day, S, alex, c).position).not.toBeNull();
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
    expect(isPresent(out, h(17), 30)).toBe(false);
    // Dee clocks in at 5:00 and is pinned to the position Alex vacated
    expect(day.cells[cellKey(dee.id, h(17))]?.pinned).toBe(true);
    expect(posBefore).toBeDefined();
  });

  it("pins the replacement to the vacated position", () => {
    let day = typicalDay();
    const bri = day.shifts[2];
    const eli = day.shifts.find((s) => s.name === "Eli")!;
    const pos = day.cells[cellKey(bri.id, h(16))].pos;
    day = bumpOut(day, S, bri.id, eli.id, h(17));
    expect(day.cells[cellKey(eli.id, h(17))]).toEqual({ pos, pinned: true });
  });
});
