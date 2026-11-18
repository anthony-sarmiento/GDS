# GDS — Geek'd Deployment System

Rotation and break tracking for the retail floor at GEEK'D Orlando. Inspired by Disney's CDS: add today's team, and GDS deals out Front / Bar / Dungeon blocks and plans everyone's breaks.

No login, no database. Everything is saved in the browser (`localStorage`) on the device you use.

## Run it

```powershell
npm install
npm run dev      # http://localhost:3000
npm test         # engine tests (break rules, rotation, cover)
npm run build
```

## Deploy

Push to GitHub, then import the repo in Vercel. It is a stock Next.js app; no environment variables needed.

## How it works

- **Team tab** – add people with clock in/out. Quick-fill buttons: Opening Lead 10–5:15, Opener 11–5, Closer 5–11, Closer 5–12, Floater 1–9, Closing Lead, Inventory Lead. *Assignment* is Rotates, Stays at a position, or a lead role. **Leads are not on the board**: they have a role (Opening / Closing / Inventory Lead) and show up on the break log and break timer only.
- **Board tab** (CDS style, minute precision)
  - *Right now*: who is on Front / Bar / Dungeon, who is on break, who is short, and who could move to cover. Each person has a **Bump** button.
  - *Break timer*: Start / End stamps real break times.
  - *Board*: a continuous timeline, one row per person, snapping to 5 minutes. Pick a **brush** (keys `1` Front, `2` Bar, `3` Dungeon, `4` Break, `0` Erase, `Esc` to put it down) and **drag across a row for an exact range**. A plain click repaints the whole block under the cursor. Neighbouring blocks on the same position merge into one. Painted ranges are pinned (thin underline) and never move on their own. Zoom with − / +.
  - *Break brush*: drag to set the exact start and end of a break, or click to drop it at that minute using its normal length.
  - *Coverage*: people on each position over the day. Red = empty, amber = short or over the max.
  - *Bump out*: send someone home and hand their position to the next shift. The replacement is pinned to that position for the rest of the block.
- **Breaks tab** – the paper break log, live. *Print log* gives a landscape page with clock in/out, break length, start/end, initials and notes. Grey times are planned; write in the real ones.
- **On a phone**: bottom tab bar, a sticky brush bar with a **Pan** mode for scrolling and a **Now** button, a narrow name column, the break log as one card per break, and dialogs that slide up as a sheet. With a brush picked, a sideways drag paints and an up/down drag still scrolls the page.
- **Clock chip (top right)** – click it to preview the board at another time. *Back to live* resets it.

### Cover rule

Someone has to be on a position while its holder is on break. When a break is placed or started, GDS moves a cover onto the position for the length of the break (the floater first, then anyone whose own position can spare them) and pins it. If the position would be left empty and nobody can move, it asks before going ahead. If it stays attended but below its minimum, the board shows it amber.

### Staffing

Front 1–2, Bar 2–3, Dungeon exactly 1 by default (editable in Team → Staffing). Auto-deal fills the minimums first (Front and Bar, then Dungeon) and sends spare people to the Bar.

### Break rules (from the paper log)

| Shift length | Breaks |
| --- | --- |
| under 7 hrs | 1 × 20 min |
| 7 to under 9 hrs | 1 × 30–60 min |
| 9 to under 12 hrs | 1 × 20 min + 1 × 30–60 min |
| 12+ hrs | 2 × 20 min + 1 × 30–60 min |

Break length is editable per break, and breaks can be added or removed. Rules live in `lib/breaks.ts` (`requiredBreaks`).

### Engine notes

- `lib/breaks.ts` – break rules and planner. Breaks are staggered (1 at a time by default), land near the middle of the shift, and prefer times when the floor is fully staffed.
- `lib/rotation.ts` – the board solver. Per 5-minute column it picks positions that meet the staffing limits, rotate at block boundaries (default hourly), stay put in between, and favor positions someone has spent the least time at. Painted columns are never touched.
- `lib/cover.ts` – the cover rule for breaks.
- `lib/store.ts` – state helpers: painting, break placement, bump out.
- "Board starts at" (default 10:00 AM) anchors the columns and rotation blocks.
