import { describe, expect, it } from "vitest";
import { breakKind, breaksOwed, onLog } from "./breaks";
import { addCheck, checkRows, checkStats, checkStatus, removeCheck } from "./checks";
import { addShift, emptyDay, placeBreak } from "./store";
import { DEFAULT_SETTINGS } from "./types";

const h = (hr: number, m = 0) => hr * 60 + m;
const S = DEFAULT_SETTINGS;

function openDay() {
  let day = emptyDay("2026-11-17");
  day = addShift(day, { name: "Alex", start: h(11), end: h(17), lock: null, floater: false });
  day = addShift(day, { name: "Flo", start: h(13), end: h(21), lock: null, floater: true });
  return day;
}

describe("break log lengths", () => {
  it("has a 20 minute kind and a 30-60 minute kind", () => {
    expect(breakKind(20)).toBe("short");
    expect(breakKind(30)).toBe("long");
    expect(breakKind(60)).toBe("long");
    expect(onLog(20)).toBe(true);
    expect(onLog(45)).toBe(true);
    expect(onLog(25)).toBe(false);
    expect(onLog(90)).toBe(false);
  });

  it("a 20 minute break uses the 20 minute slot, not the 30-60 one", () => {
    const day = openDay();
    const flo = day.shifts[1]; // 8 hrs: one 30-60 break on the log
    const alex = day.shifts[0]; // 6 hrs: one 20 minute break on the log
    expect(flo.breaks.map((b) => b.length)).toEqual([30]);
    const placed = placeBreak(day, alex.id, h(14), 20).day.shifts[0];
    expect(placed.breaks).toHaveLength(1);
    expect(placed.breaks[0].planned).toBe(h(14));
    expect(placed.breaks[0].length).toBe(20);
  });

  it("a 20 minute break for someone who only owes a 30-60 break is an extra one and leaves the 30-60 owed", () => {
    const day = openDay();
    const flo = day.shifts[1];
    const after = placeBreak(day, flo.id, h(16), 20).day.shifts[1];
    expect(after.breaks).toHaveLength(2);
    expect(after.breaks.find((b) => b.length === 30)?.planned).toBeNull();
    expect(after.breaks.find((b) => b.length === 20)?.planned).toBe(h(16));
    expect(breaksOwed(after).long.unplaced).toBe(1);
  });

  it("a 45 minute break fills the 30-60 slot", () => {
    const day = openDay();
    const flo = day.shifts[1];
    const after = placeBreak(day, flo.id, h(16), 45).day.shifts[1];
    expect(after.breaks).toHaveLength(1);
    expect(after.breaks[0].length).toBe(45);
    expect(after.breaks[0].planned).toBe(h(16));
  });
});

describe("bathroom checks", () => {
  it("counts time since the last check once the store is open", () => {
    let day = openDay();
    expect(checkStatus(day, S, h(10)).since).toBeNull(); // not open yet
    const none = checkStatus(day, S, h(12, 30));
    expect(none.never).toBe(true);
    expect(none.since).toBe(90); // counted from opening at 11
    expect(none.due).toBe(true);

    day = addCheck(day, h(12), "Alex");
    const s = checkStatus(day, S, h(13, 10));
    expect(s.last?.by).toBe("Alex");
    expect(s.since).toBe(70);
    expect(s.due).toBe(false);
    expect(s.nextAt).toBe(h(13, 30));
    expect(checkStatus(day, S, h(13, 30)).due).toBe(true);
  });

  it("is quiet once the store has closed", () => {
    expect(checkStatus(openDay(), S, h(21, 30)).due).toBe(false);
  });

  it("previewing an earlier time ignores later checks", () => {
    const day = addCheck(openDay(), h(15));
    expect(checkStatus(day, S, h(14)).last).toBeNull();
  });

  it("lists checks with the gap since the one before, and flags long gaps", () => {
    let day = openDay();
    day = addCheck(day, h(12));
    day = addCheck(day, h(13, 15));
    day = addCheck(day, h(15, 30));
    const rows = checkRows(day, S);
    expect(rows.map((r) => r.gap)).toEqual([60, 75, 135]);
    expect(rows.map((r) => r.long)).toEqual([false, false, true]);
    const stats = checkStats(day);
    expect(stats.count).toBe(3);
    expect(stats.longest).toBe(135);
    expect(stats.average).toBe(105);
  });

  it("removes a check", () => {
    let day = addCheck(openDay(), h(12));
    day = removeCheck(day, day.checks![0].id);
    expect(day.checks).toHaveLength(0);
  });

  it("works on days saved before checks existed", () => {
    const { checks, ...old } = openDay();
    void checks;
    expect(checkRows(old, S)).toEqual([]);
    expect(addCheck(old, h(12)).checks).toHaveLength(1);
  });
});
