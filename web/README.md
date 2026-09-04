# Cricket Polls — Web App

React + Vite + Tailwind. Mobile-first, built to be usable one-handed on
stadium wifi.

## Run

```bash
cp .env.example .env    # only needed if the API is not on localhost:4000
npm install
npm run dev             # http://localhost:5173
npm run build
```

`vite.config.js` proxies `/api` and `/ws` to `http://localhost:4000` in dev, so
there is nothing to configure locally. For a deployed build, set
`VITE_API_URL` — it drives both the REST base and the WebSocket URL.

## Routes

| Route | What it is |
| --- | --- |
| `/` | Live polls, votable in place |
| `/poll/:id` | One poll full screen, live results |
| `/history` | Closed polls with final results |
| `/admin` | Password-protected console (unlisted — no nav link) |

## Live results

Results arrive over one shared WebSocket (`src/lib/realtime.js`) with
exponential-backoff reconnect. A timed refetch runs alongside it: every 3s
while the socket is down, every 15s as a safety net while it is up. The
`useLive` hook (`src/lib/useLive.js`) combines the two, and also refetches when
the tab becomes visible or the browser fires `online` — the states a phone
actually hits in a crowd.

Failure is split deliberately: a failed **first** load shows an error, while a
failed **background** refresh keeps the last good numbers on screen under a
"weak signal" note. The header badge shows `Live` when the socket is connected
and `Retry` when it is reconnecting; it is hidden where nothing subscribes.

## Double voting

`voter_id` is a device id generated once and kept in `localStorage`
(`src/lib/device.js`), sent explicitly on every vote — no session, no cookie,
which is why a bot can make the identical call. The option chosen is cached
locally too, so a reload shows results immediately instead of flashing the
ballot. On mount the app still asks the server (`GET /polls/:id/my-vote`), which
catches a vote that landed but whose local record was lost.

Every storage access is wrapped: in private mode or with storage disabled the
id falls back to memory for the tab and voting still works.

A rejected vote is not a dead end — `already_voted` and `poll_closed` both
carry the current results, so the app shows the board instead of an error.

## Design notes

- **Scoreboard, not a form.** Dark ground, one hot accent (amber) for live and
  leading, one cool accent (teal) for your own pick, red only for errors.
- **Thumb-sized targets.** Nothing interactive is under 56px tall.
- **Numbers that don't jitter.** `font-variant-numeric: tabular-nums` globally,
  so a tally ticking up doesn't shift the layout.
- **One tap to vote.** No confirm step — a poll has to be answerable between
  balls.
- **Cheap animation.** Only bar width transitions; `prefers-reduced-motion` is
  respected.

## Structure

```
src/
  components/   Chrome (shell), Ballot, ResultBars, VoteOptions, PollForm, ui
  lib/          api client, device id, realtime socket, useLive hook
  pages/        Home, PollPage, History, Admin
```

`Ballot` is the shared vote-then-results unit used by both the live list and
the poll page, so voting behaves identically wherever it is tapped.
