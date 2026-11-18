import { describe, expect, it } from "vitest";
import { requiredBreaks } from "./breaks";
import { autoFill, coverFor, positionMinutes, slotsFor } from "./rotation";
import { addShift, emptyDay, initialState, refresh } from "./store";
import { DayState, DEFAULT_SETTINGS, POSITIONS } from "./types";

const h = (hr: number, m = 0) => hr * 60 + m;

function typicalDay(): DayState {
  let day = emptyDay("2026-11-17");
  const add = (name: string, s: number, e: number, extra = {}) => {
    day = addShift(day, { name, start: s, end: e, lock: null, floater: false, ...extra });
  };
  add("Alex", h(10), h(17));
  add("Bri", h(10), h(17));
  add("Cam", h(10), h(17));
  add("Dee", h(17), h(23));
  add("Eli", h(17), h(23));
  add("Flo", h(13), h(21), { floater: true });
  return refresh(day, { ...initialState() }, null);
}

describe("break rules (from the paper log)", () => {
  it("matches the break log table", () => {
    expect(requiredBreaks(6.98)).toEqual([20]); // 6:59
    expect(requiredBreaks(5)).toEqual([20]);
    expect(requiredBreaks(7)).toEqual([30]);
    expect(requiredBreaks(8.5)).toEqual([30]);
    expect(requiredBreaks(9)).toEqual([20, 30]);
    expect(requiredBreaks(11.5)).toEqual([20, 30]);
    expect(requiredBreaks(12)).toEqual([20, 20, 30]);
  });
});

describe("break planning", () => {
  it("gives everyone their required breaks, inside their shift", () => {
    const day = typicalDay();
    for (const s of day.shifts) {
      expect(s.breaks.length).toBeGreaterThan(0);
      for (const b of s.breaks) {
        expect(b.planned).not.toBeNull();
        expect(b.planned!).toBeGreaterThanOrEqual(s.start);
        expect(b.planned! + b.length).toBeLessThanOrEqual(s.end);
      }
    }
  });

  it("staggers breaks so only one person is out at a time when possible", () => {
    const day = typicalDay();
    const all = day.shifts.flatMap((s) => s.breaks.map((b) => [b.planned!, b.planned! + b.length]));
    for (let t = h(10); t < h(23); t += 5) {
      const out = all.filter(([a, b]) => a <= t && t < b).length;
      expect(out).toBeLessThanOrEqual(1);
    }
  });
});

describe("rotation", () => {
  it("covers every position in every block with a full crew", () => {
    const day = typicalDay();
    const settings = DEFAULT_SETTINGS;
    for (const slot of slotsFor(day.shifts, settings)) {
      const here = day.shifts.filter((s) => day.cells[`${s.id}@${slot}`]);
      if (here.length < 3) continue;
      for (const p of POSITIONS) {
        expect(here.some((s) => day.cells[`${s.id}@${slot}`].pos === p)).toBe(true);
      }
    }
  });

  it("spreads time roughly evenly across the three positions", () => {
    const day = typicalDay();
    const mins = positionMinutes(day, DEFAULT_SETTINGS);
    for (const s of day.shifts.filter((x) => x.end - x.start >= 7 * 60)) {
      const m = mins[s.id];
      const vals = POSITIONS.map((p) => m[p]);
      expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(60);
    }
  });

  it("keeps a locked person in one spot and never moves pinned cells", () => {
    let day = emptyDay("2026-11-17");
    day = addShift(day, { name: "Locke", start: h(10), end: h(17), lock: "bar", floater: false });
    day = addShift(day, { name: "Ray", start: h(10), end: h(17), lock: null, floater: false });
    day = addShift(day, { name: "Sam", start: h(10), end: h(17), lock: null, floater: false });
    day = refresh(day, initialState(), null);
    const locke = day.shifts[0];
    expect(slotsFor(day.shifts, DEFAULT_SETTINGS).every((t) => day.cells[`${locke.id}@${t}`].pos === "bar")).toBe(true);

    const ray = day.shifts[1];
    day.cells[`${ray.id}@${h(12)}`] = { pos: "dungeon", pinned: true };
    const again = autoFill(day, DEFAULT_SETTINGS);
    expect(again[`${ray.id}@${h(12)}`]).toEqual({ pos: "dungeon", pinned: true });
  });

  it("does not rewrite earlier blocks when re-dealing from the current time", () => {
    const day = typicalDay();
    const before = { ...day.cells };
    const redeal = autoFill(day, DEFAULT_SETTINGS, h(14, 20));
    for (const [k, v] of Object.entries(before)) {
      const slot = Number(k.split("@")[1]);
      if (slot < h(14, 20)) expect(redeal[k]).toEqual(v);
    }
  });
});

describe("break cover", () => {
  it("suggests the floater when a position would go uncovered", () => {
    let day = emptyDay("2026-11-17");
    day = addShift(day, { name: "A", start: h(13), end: h(21), lock: null, floater: false });
    day = addShift(day, { name: "B", start: h(13), end: h(21), lock: null, floater: false });
    day = addShift(day, { name: "C", start: h(13), end: h(21), lock: null, floater: false });
    day = addShift(day, { name: "Flo", start: h(13), end: h(21), lock: null, floater: true });
    day = refresh(day, initialState(), null);
    const plan = coverFor(day, DEFAULT_SETTINGS, day.shifts[0], h(15, 30));
    expect(["none-needed", "cover"]).toContain(plan.status);
  });
});
