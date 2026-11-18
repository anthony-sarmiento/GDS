import { applyBreakChange, assignCover } from "@/lib/cover";
import { DayState, POSITION_LABEL } from "@/lib/types";
import { fmt } from "@/lib/time";
import { Ctx } from "./ctx";

/**
 * Apply a break change (place, move, start...) with the cover rule:
 * somebody has to be on the position while the person is away.
 * - If someone can cover, they are moved onto the position for the length of the break.
 * - If nobody can, ask before going ahead.
 * `build` returns the changed day and the id of the break that changed.
 */
export function runBreakChange(
  ctx: Ctx,
  build: (d: DayState) => { day: DayState; breakId: string | null },
): boolean {
  const { settings } = ctx;
  const probe = build(ctx.day);
  if (!probe.breakId) return false;
  const shiftOf = (d: DayState) => d.shifts.find((s) => s.breaks.some((b) => b.id === probe.breakId));
  const owner = shiftOf(probe.day);
  if (!owner) return false;

  const check = assignCover(probe.day, settings, owner.id, probe.breakId);
  const span = check.span;
  if (check.status === "uncovered" && check.position && span) {
    const ok = window.confirm(
      `Nobody is free to cover ${POSITION_LABEL[check.position]} while ${owner.name} is on break (${fmt(span[0])}–${fmt(span[1])}).\n\nPut the break there anyway?`,
    );
    if (!ok) return false;
  }

  ctx.mutate((d) => applyBreakChange(d, settings, build), { auto: "fill" });

  if (check.status === "covered" && check.cover && check.position && span) {
    ctx.flash(`${check.cover.name} covers ${POSITION_LABEL[check.position]} ${fmt(span[0])}–${fmt(span[1])}`);
  } else if (check.status === "short" && check.position && span) {
    ctx.flash(
      `${POSITION_LABEL[check.position]} runs short during the break (${check.remaining} of ${ctx.settings.limits[check.position].min})`,
    );
  }
  return true;
}
