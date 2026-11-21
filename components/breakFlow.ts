import { analyzeCover, applyBreakChange, assignCover } from "@/lib/cover";
import { breakSpan } from "@/lib/rotation";
import { DayState, POSITION_LABEL } from "@/lib/types";
import { fmt } from "@/lib/time";
import { Ctx } from "./ctx";

/**
 * Apply a break change (place, move, start...) with the cover rule:
 * somebody has to be on the position while the person is away.
 *
 * By default it asks who should rotate over (suggesting the best choice). Pass `ask: false` for
 * small edits (typing a time into the log) to let GDS pick the cover itself.
 * Breaks for leads and for people on a custom block have no position to cover, so they never ask.
 * `build` returns the changed day and the id of the break that changed.
 */
export function runBreakChange(
  ctx: Ctx,
  build: (d: DayState) => { day: DayState; breakId: string | null },
  opts: { ask?: boolean; verb?: "start" | "place" } = {},
): boolean {
  const { settings } = ctx;
  const { ask = true, verb = "start" } = opts;
  const probe = build(ctx.day);
  if (!probe.breakId) return false;
  const owner = probe.day.shifts.find((s) => s.breaks.some((b) => b.id === probe.breakId));
  if (!owner) return false;
  const brk = owner.breaks.find((b) => b.id === probe.breakId)!;

  const analysis = analyzeCover(probe.day, settings, owner.id, probe.breakId);
  const span = breakSpan(brk);

  const apply = (choice?: string | null) => {
    ctx.mutate((d) => applyBreakChange(d, settings, build, choice), { auto: true });
    const res = assignCover(probe.day, settings, owner.id, probe.breakId!, choice);
    if (res.status === "covered" && res.cover && res.position && span) {
      ctx.flash(`${res.cover.name} covers ${POSITION_LABEL[res.position]} ${fmt(span[0])}–${fmt(span[1])}`);
    } else if (res.status === "short" && res.position) {
      ctx.flash(`${POSITION_LABEL[res.position]} runs short during the break (${res.remaining} of ${analysis.min})`);
    } else if (res.status === "uncovered" && res.position) {
      ctx.flash(`${POSITION_LABEL[res.position]} is empty during the break`);
    }
  };

  if (!ask || !analysis.position || !span) {
    // nothing to ask: no position to cover, or a quiet edit
    if (ask === false && analysis.position && analysis.needs && analysis.remaining === 0) {
      const res = assignCover(probe.day, settings, owner.id, probe.breakId);
      if (res.status === "uncovered" && span) {
        const ok = window.confirm(
          `Nobody is free to cover ${POSITION_LABEL[analysis.position]} while ${owner.name} is on break (${fmt(span[0])}–${fmt(span[1])}).\n\nPut the break there anyway?`,
        );
        if (!ok) return false;
      }
    }
    apply(undefined);
    return true;
  }

  ctx.askCover({
    title: verb === "start" ? `Send ${owner.name} on break` : `Put ${owner.name}'s break here`,
    confirmLabel: verb === "start" ? "Send on break" : "Place break",
    holder: owner.name,
    position: analysis.position,
    when: `${fmt(span[0])}–${fmt(span[1])} · ${brk.length} min`,
    remaining: analysis.remaining,
    min: analysis.min,
    options: analysis.options,
    onConfirm: (choice) => apply(choice),
  });
  return true;
}
