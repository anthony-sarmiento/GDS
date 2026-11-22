import { describe, expect, it } from "vitest";
import { planFromPreferences } from "./plan";
import { afterRotation, applyRotation, floorAt, suggestRotation } from "./rotate";
import { autoFill, breakAtCell, cellKey } from "./rotation";
import { addShift, assignRange, emptyDay, updateBreak } from "./store";
import { DayState, DEFAULT_SETTINGS, Position } from "./types";

const h = (hr: number, m = 0) => hr * 60 + m;
const S = DEFAULT_SETTINGS;

/** Lead has set every starting position before anyone arrives. */
function setUp(): DayState {
  let day = emptyDay("2026-11-17");
  const add = (name: string, s: number, e: number) => (day = addShift(day, { name, start: s, end: e, lock: null, floater: false }));
  add("Alex", h(11), h(17));
  add("Bri", h(11), h(17));
  add("Cam", h(11), h(17));
  add("Flo", h(13), h(21));
  const spots: Record<string, Position> = { Alex: "front", Bri: "bar", Cam: "dungeon", Flo: "bar" };
  for (const s of day.shifts) day = assignRange(day, S, s.id, s.start, s.end, spots[s.name]);
  return { ...day, cells: autoFill(day, S) };
}
const find = (d: DayState, name: string) => d.shifts.find((s) => s.name === name)!;
const prefer = (d: DayState, name: string, t: number, which = 0) => {
  const s = find(d, name);
  return updateBreak(d, s.id, s.breaks[which].id, { preferred: t });
};

describe("planning breaks around what people asked for", () => {
  it("gives someone the time they asked for when the floor can take it", () => {
    const day = prefer(setUp(), "Cam", h(15));
    const plan = planFromPreferences(day, S);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].placed).toBe(h(15));
    expect(plan.items[0].moved).toBe(0);
    expect(find(plan.day, "Cam").breaks[0].planned).toBe(h(15));
  });

  it("moves the second person when two ask for the same time", () => {
    let day = prefer(setUp(), "Alex", h(14));
    day = prefer(day, "Bri", h(14));
    const plan = planFromPreferences(day, S);
    const times = plan.items.map((i) => i.placed).sort();
    expect(plan.items).toHaveLength(2);
    // 20 minute breaks: nobody overlaps
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(20);
    expect(plan.items.filter((i) => i.moved === 0)).toHaveLength(1);
  });

  it("keeps a break inside the shift even if they asked for before clock in", () => {
    const plan = planFromPreferences(prefer(setUp(), "Alex", h(10, 40)), S);
    expect(plan.items[0].placed).toBeGreaterThanOrEqual(h(11));
  });

  it("leaves breaks nobody asked about alone, and does not change the original day", () => {
    const day = prefer(setUp(), "Cam", h(15));
    const plan = planFromPreferences(day, S);
    expect(plan.skipped).toBe(3);
    expect(find(plan.day, "Bri").breaks[0].planned).toBeNull();
    expect(find(day, "Cam").breaks[0].planned).toBeNull();
  });

  it("says when a position cannot be kept staffed", () => {
    // Alex is the only one on the Front: the plan finds a cover but the move leaves the Bar short
    const plan = planFromPreferences(prefer(setUp(), "Alex", h(15)), S);
    expect(plan.items[0].coverName).not.toBeNull();
    expect(plan.items[0].short).toBe(true);
  });

  it("does not move breaks that were already taken", () => {
    let day = prefer(setUp(), "Cam", h(15));
    const cam = find(day, "Cam");
    day = updateBreak(day, cam.id, cam.breaks[0].id, { start: h(12), end: h(12, 20) });
    expect(planFromPreferences(day, S).items).toHaveLength(0);
  });
});

describe("rotating", () => {
  it("suggests everyone moves to a different position and the headcount stays the same", () => {
    const day = setUp();
    const moves = suggestRotation(day, S, h(14));
    expect(moves.every((m) => m.dest !== "stay")).toBe(true);
    expect(afterRotation(day, S, h(14), moves)).toEqual({ front: 1, bar: 2, dungeon: 1 });
  });

  it("moves people with a short walk, then they stay there", () => {
    const day = setUp();
    const alex = find(day, "Alex");
    const next = applyRotation(day, S, h(14), [
      { shiftId: alex.id, dest: "bar" },
      { shiftId: find(day, "Cam").id, dest: "stay" },
    ]);
    expect(next.cells[cellKey(alex.id, h(14))]).toMatchObject({ transit: true });
    expect(next.cells[cellKey(alex.id, h(14, 5))]?.pos).toBe("bar");
    expect(next.cells[cellKey(alex.id, h(16))]?.pos).toBe("bar");
    expect(next.cells[cellKey(alex.id, h(13, 55))]?.pos).toBe("front");
    expect(next.cells[cellKey(find(day, "Cam").id, h(14))]?.pos).toBe("dungeon");
  });

  it("sends someone on break and, afterwards, to the spot of whoever took theirs", () => {
    const day = setUp();
    const next = applyRotation(day, S, h(14), [
      { shiftId: find(day, "Alex").id, dest: "bar" }, // takes Bri's spot
      { shiftId: find(day, "Bri").id, dest: "break" },
      { shiftId: find(day, "Flo").id, dest: "front" }, // takes Alex's spot
    ]);
    const bri = find(next, "Bri");
    expect(bri.breaks[0].planned).toBe(h(14));
    expect(breakAtCell(bri, h(14, 10), 5)).toBeDefined();
    const filled = { ...next, cells: autoFill(next, S) };
    expect(filled.cells[cellKey(bri.id, h(13, 55))]?.pos).toBe("bar");
    expect(filled.cells[cellKey(bri.id, h(14, 25))]?.pos).toBe("front"); // Alex's old spot
    expect(filled.cells[cellKey(find(next, "Alex").id, h(15))]?.pos).toBe("bar");
    expect(filled.cells[cellKey(find(next, "Flo").id, h(15))]?.pos).toBe("front");
    expect(floorAt(filled, S, h(14, 10)).map((p) => p.shift.name).sort()).toEqual(["Alex", "Cam", "Flo"]);
  });
});
