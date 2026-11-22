import { describe, expect, it } from "vitest";
import { applyChain, peopleAt, positionAt } from "./chain";
import { autoFill, breakAtCell, cellKey } from "./rotation";
import { addShift, assignRange, emptyDay } from "./store";
import { DayState, DEFAULT_SETTINGS, Position } from "./types";

const h = (hr: number, m = 0) => hr * 60 + m;
const S = DEFAULT_SETTINGS;

function setUp(): DayState {
  let day = emptyDay("2026-11-17");
  const add = (name: string) => (day = addShift(day, { name, start: h(11), end: h(17), lock: null, floater: false }));
  ["Anna", "Ben", "Cy", "Dee"].forEach(add);
  const spots: Record<string, Position> = { Anna: "front", Ben: "bar", Cy: "dungeon", Dee: "bar" };
  for (const s of day.shifts) day = assignRange(day, S, s.id, s.start, s.end, spots[s.name]);
  return { ...day, cells: autoFill(day, S) };
}
const find = (d: DayState, n: string) => d.shifts.find((s) => s.name === n)!;
const at = (d: DayState, n: string, t: number) => autoFill(d, S)[cellKey(find(d, n).id, t)];

describe("rotation chains", () => {
  it("knows who is on a position", () => {
    const day = setUp();
    expect(peopleAt(day, S, "bar", h(14)).map((s) => s.name).sort()).toEqual(["Ben", "Dee"]);
    expect(positionAt(day, S, find(day, "Cy"), h(14))).toBe("dungeon");
    expect(peopleAt(day, S, "bar", h(14), [find(day, "Ben").id]).map((s) => s.name)).toEqual(["Dee"]);
  });

  it("Dee goes to the Front sending Anna to the Bar, Ben to the Dungeon and Cy on break", () => {
    const d0 = setUp();
    const end = find(d0, "Anna").end;
    const day = applyChain(d0, S, h(14), [
      { shiftId: find(d0, "Dee").id, dest: "front", until: end },
      { shiftId: find(d0, "Anna").id, dest: "bar", until: end },
      { shiftId: find(d0, "Ben").id, dest: "dungeon", until: end },
      { shiftId: find(d0, "Cy").id, dest: "break", until: h(14, 20) },
    ]);
    // everyone walks, then stands in the new place
    expect(at(day, "Dee", h(14))).toMatchObject({ transit: true });
    expect(at(day, "Dee", h(15))?.pos).toBe("front");
    expect(at(day, "Anna", h(15))?.pos).toBe("bar");
    expect(at(day, "Ben", h(15))?.pos).toBe("dungeon");
    // Cy is on break for 20 minutes, then takes the spot Ben left (the Bar)
    const cy = find(day, "Cy");
    expect(cy.breaks[0].planned).toBe(h(14));
    expect(breakAtCell(cy, h(14, 10), 5)).toBeDefined();
    expect(at(day, "Cy", h(14, 30))?.pos).toBe("bar");
    expect(at(day, "Cy", h(16))?.pos).toBe("bar");
    // before the chain nothing changed
    expect(at(day, "Anna", h(13, 55))?.pos).toBe("front");
  });

  it("a bumpout in the chain sends that person home and says who took over", () => {
    const d0 = setUp();
    const end = find(d0, "Anna").end;
    const day = applyChain(d0, S, h(14), [
      { shiftId: find(d0, "Dee").id, dest: "front", until: end },
      { shiftId: find(d0, "Anna").id, dest: "bumpout", until: end },
    ]);
    const anna = find(day, "Anna");
    expect(anna.sentHomeAt).toBe(h(14));
    expect(anna.bumpedBy).toBe("Dee");
    expect(at(day, "Dee", h(15))?.pos).toBe("front");
  });
});

describe("times in a chain", () => {
  it("lets each person start and stop at their own time", () => {
    const d0 = setUp();
    const end = find(d0, "Anna").end;
    const day = applyChain(d0, S, h(14), [
      { shiftId: find(d0, "Dee").id, dest: "front", until: end },
      { shiftId: find(d0, "Anna").id, dest: "bar", from: h(14, 10), until: h(15) },
      { shiftId: find(d0, "Ben").id, dest: "break", from: h(14, 30), until: h(15) },
    ]);
    // Anna keeps the Front until 2:10, then goes to the Bar until 3:00
    expect(at(day, "Anna", h(14, 5))?.pos).toBe("front");
    expect(at(day, "Anna", h(14, 30))?.pos).toBe("bar");
    expect(at(day, "Anna", h(14, 55))).toMatchObject({ pos: "bar", ends: true });
    // Ben's break is 30 minutes starting at 2:30
    const ben = find(day, "Ben");
    const placed = ben.breaks.find((b) => b.planned != null)!;
    expect(placed.planned).toBe(h(14, 30));
    expect(placed.length).toBe(30);
  });
});
