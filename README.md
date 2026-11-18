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

- **Team tab** – add people with clock in/out. Quick-fill buttons: Lead opener 10–5:15, Opener 11–5, Closer 5–11, Closer 5–12, Floater 1–9. Choose *Stays at …* for anyone who wants one spot all day. Settings hold the column size, auto-rotate interval and the SOP staffing limits.
- **Board tab** (CDS style)
  - *Right now*: who is on Front / Bar / Dungeon, who is on break, who is short, and who could move to cover. Each person has a **Bump** button.
  - *Break timer*: Start / End stamps real break times.
  - *Board*: one row per person, one column per 30 minutes (15 in Settings). Pick a **brush** (keys `1` Front, `2` Bar, `3` Dungeon, `4` Break, `0` Erase, `Esc` to put it down), then click or drag across a row. Painted blocks are pinned (dot) and never move on their own. The **Break** brush puts a break at that spot, and dragging across columns sets its length. Break tiles go green while someone is actually on break.
  - *Coverage*: people on each position per column. Red = open, amber = short or over the max.
  - *Bump out*: send someone home and hand their position to the next shift. The replacement is pinned to that position for the rest of the block.
- **Breaks tab** – the paper break log, live. Print it with *Print log*.
- **Clock chip (top right)** – click it to preview the board at another time. *Back to live* resets it.

### Staffing (SOP)

Front 1–2, Bar 2–3, Dungeon exactly 1 by default (editable in Team → Staffing). Auto-deal fills the minimums first (Front and Bar, then Dungeon), sends spare people to the Bar, and shifts someone over to cover when a break drops a position below its minimum.

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
- `lib/rotation.ts` – the board solver. Per column it picks positions that meet the SOP limits, rotate at block boundaries (default hourly), stay put in between, and favor positions someone has spent the least time at. Painted columns are never touched.
- `lib/store.ts` – state helpers: painting, break placement, bump out.
- "Board starts at" (default 10:00 AM) anchors the columns and rotation blocks.
