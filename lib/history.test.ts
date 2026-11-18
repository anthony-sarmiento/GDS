import { describe, expect, it } from "vitest";
import { emptyHistory, recordChange, stepBack, stepForward } from "./history";

const same = (a: string, b: string) => a === b;

describe("undo history", () => {
  it("steps back to each earlier state and forward again", () => {
    let h = emptyHistory<string>();
    h = recordChange(h, "a", 0);
    h = recordChange(h, "b", 5000);
    h = recordChange(h, "c", 10000);

    const one = stepBack(h, "d", same);
    expect(one.state).toBe("c");
    const two = stepBack(one.history, "c", same);
    expect(two.state).toBe("b");

    const redo = stepForward(two.history, "b", same);
    expect(redo.state).toBe("c");
  });

  it("counts a quick burst of edits (typing) as one step", () => {
    let h = emptyHistory<string>();
    h = recordChange(h, "start", 0);
    h = recordChange(h, "s", 100);
    h = recordChange(h, "st", 200);
    h = recordChange(h, "sta", 300);
    expect(h.undo).toEqual(["start"]);
    expect(stepBack(h, "star", same).state).toBe("start");
  });

  it("a new change clears redo", () => {
    let h = emptyHistory<string>();
    h = recordChange(h, "a", 0);
    const back = stepBack(h, "b", same);
    expect(back.history.redo).toEqual(["b"]);
    const again = recordChange(back.history, "a", 9000);
    expect(again.redo).toEqual([]);
  });

  it("skips snapshots that match the current state and reports nothing to undo", () => {
    let h = emptyHistory<string>();
    h = recordChange(h, "same", 0);
    expect(stepBack(h, "same", same).state).toBeNull();
    expect(stepBack(emptyHistory<string>(), "x", same).state).toBeNull();
  });

  it("keeps only the most recent 60 steps", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 100; i += 1) h = recordChange(h, i, i * 10000);
    expect(h.undo).toHaveLength(60);
    expect(h.undo[0]).toBe(40);
  });
});
