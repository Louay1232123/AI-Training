# 🏏 Cricket Polls

Live polls for cricket matches. Ask the crowd who wins the toss, watch the bars
move between balls.

Built so the web app is the **first** channel, not the only one: the API knows
nothing about browsers, so a WhatsApp bot, a Telegram bot or a mobile app plugs
into the same endpoints without touching web code.

```
                 ┌──────────────────────────────────┐
   web app ─────▶│                                  │
   (built)       │   channel adapters               │
                 │   ├── web       ✅ live          │
   bots ────────▶│   ├── app       ✅ live          │──▶ services ──▶ SQLite
   (Phase 2)     │   ├── whatsapp  ⏳ accepts votes │    (rules)      (1 file)
                 │   └── telegram  ⏳ accepts votes │
   mobile ──────▶│                                  │
   (later)       └──────────────────────────────────┘
```

## Quick start

```bash
npm run setup                       # installs backend + web

cd backend && cp .env.example .env  # set ADMIN_PASSWORD
cd ..

npm run seed                        # optional sample polls
npm run dev:api                     # terminal 1 → http://localhost:4000
npm run dev:web                     # terminal 2 → http://localhost:5173
```

Then open <http://localhost:5173> to vote, and
<http://localhost:5173/admin> to run polls (the password from `.env`).

Other scripts: `npm test` (21 backend tests), `npm run build` (web production
build), `npm start` (API only).

## What's here

| Folder | What it is | Status |
| --- | --- | --- |
| [`backend/`](backend/) | Express + SQLite API, WebSocket results feed | ✅ Built |
| [`web/`](web/) | React + Vite + Tailwind scoreboard | ✅ Built |
| [`bots/`](bots/) | WhatsApp / Telegram hook-in guide | ⏳ Phase 2 stub |

Each folder has its own README with the detail.

## Data model

```
polls          id, question, match_name, status (draft|live|closed),
               created_at, updated_at, closes_at, closed_at
poll_options   id, poll_id, label, position
votes          id, poll_id, option_id, voter_id, channel, ip_hash, created_at
```

Options live in their own table rather than a JSON column so votes can
reference them by id and a tally is one `GROUP BY`.

## Why it's channel-agnostic

A voter is **an opaque string plus a channel name**. Nothing else. There is no
session, no cookie, no browser assumption anywhere in the API:

- the web app sends a device id it generated and keeps in `localStorage`
- a Telegram bot would send `message.from.id`
- a WhatsApp bot would send the sender's phone number
- a mobile app would send a per-install id

Votes are keyed on `(poll_id, channel, voter_id)`, so ids can never collide
across channels. A channel adapter decides only two things — how to identify a
voter, and how to render a poll — and everything below it is shared. Adding a
channel is one line in
[`backend/src/channels/index.js`](backend/src/channels/index.js).

You can see this working today without a bot in sight:

```bash
# Vote as a Telegram user, replying "2" the way a person would in a chat
curl -X POST http://localhost:4000/api/polls/<POLL_ID>/vote \
  -H 'Content-Type: application/json' \
  -d '{"reply":"2","voter_id":"12345","channel":"telegram"}'
```

The reply comes back chat-rendered rather than as chart data:

```
*Who wins the toss?*
India vs Australia · 2nd ODI

████████░░ 78%  India (14)
██░░░░░░░░ 22%  Australia (4)

18 votes · voting open
```

## Double voting

Two layers, because neither is enough alone:

1. **Identity (hard).** A unique index on `(poll_id, channel, voter_id)`. The
   web app's device id survives reloads and tab closes.
2. **Network (backup).** Votes per poll from one IP are capped, and the IP is
   stored only as a salted hash. The cap is generous by design (40 by default):
   a whole stand shares one stadium NAT address, so a strict one-vote-per-IP
   rule would lock out most of the ground.

Clearing browser storage still gets you a second vote. That is the standing
trade-off for a poll with no login, and the honest ceiling on accuracy here.

## Built for a stadium

- Results over a WebSocket, with a timed refetch as a fallback — a dropped
  socket means slower updates, never a frozen board.
- A failed background refresh keeps the last known scores on screen under a
  "weak signal" note.
- Refetches when the tab becomes visible or the browser comes back online.
- 56px minimum tap targets, one tap to vote, no confirm step.
- Production bundle is ~62 kB gzipped.

## Admin

One password from the environment (`ADMIN_PASSWORD`), no user table, compared
in constant time. `/admin` is unlinked from the public nav; the password is held
in `sessionStorage`, so it is gone when the tab closes.

## Phase 2

Not built, deliberately. The extension points exist and the flow is documented
in [`bots/README.md`](bots/README.md) — a bot needs only a transport (receive
webhook → call the vote endpoint → reply with the returned text). No API change
is required for it.
