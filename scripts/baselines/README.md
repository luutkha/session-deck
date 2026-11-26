# Grid screenshot baselines

`node scripts/e2e-grid-shots.cjs` compares clipped screenshots of the session grid against these PNGs.

| File | Shot |
| --- | --- |
| `grid-default.png` | 2x2 grid of four shell sessions at 1400x900 |
| `grid-focused.png` | same, with the second cell focused (primary focus ring) |
| `grid-narrow.png` | same focus at a 900px-wide viewport |

Generate or refresh them against the built app:

```
npx electron-vite build
UPDATE_BASELINES=1 node scripts/e2e-grid-shots.cjs
node scripts/e2e-grid-shots.cjs   # must pass
```

Terminal text, clocks and timers are hidden by injected CSS before capture, so only layout/chrome is compared.
A shot fails when more than 0.5% of pixels differ by more than 8 on any RGB channel; the actual image and a
red-highlight diff are written to `actual/` on failure. With no baselines present, the script prints
`SKIP no baseline` listing all three shots and exits 0 (unless `UPDATE_BASELINES=1`).

Pure unit tests for the PNG codec and comparison need no app: `node scripts/e2e-grid-shots.cjs --self-test`.
