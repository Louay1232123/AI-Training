# Cricket Polls — Backend

Channel-agnostic polling API. Node + Express + SQLite (one file), with a
WebSocket feed for live results.

The API makes no assumptions about who is calling it. A voter is an opaque
`voter_id` string plus a `channel` name — a browser device id, a WhatsApp phone
number, a Telegram user id or a mobile install id all work unchanged.

## Run

```bash
cp .env.example .env      # set ADMIN_PASSWORD
npm install
npm run seed              # optional sample polls
npm start                 # http://localhost:4000
npm test                  # 21 end-to-end tests, in-memory database
```

## Endpoints

### Public

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness check |
| `GET` | `/api/channels` | Registered channels |
| `GET` | `/api/polls/live` | Open polls |
| `GET` | `/api/polls/history` | Closed polls with final results |
| `GET` | `/api/polls/:id` | One poll |
| `GET` | `/api/polls/:id/results` | Current tally |
| `GET` | `/api/polls/:id/my-vote?voter_id=…` | Has this voter voted? |
| `POST` | `/api/polls/:id/vote` | Cast a vote |

### Admin — `Authorization: Bearer <ADMIN_PASSWORD>` (or `x-admin-password`)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/admin/session` | Verify a password |
| `GET` | `/api/admin/polls` | All polls, any state, with tallies |
| `POST` | `/api/admin/polls` | Create a poll |
| `PATCH` | `/api/admin/polls/:id` | Edit a poll |
| `POST` | `/api/admin/polls/:id/close` | Close a poll |
| `POST` | `/api/admin/polls/:id/open` | Publish a draft / reopen |
| `DELETE` | `/api/admin/polls/:id` | Delete a poll |

### Voting

```http
POST /api/polls/:id/vote
Content-Type: application/json

{ "option_id": "…", "voter_id": "device-abc", "channel": "web" }
```

`channel` may also arrive as an `x-channel` header, and `voter_id` as
`x-device-id`. Chat channels can send `"reply": "2"` (a 1-based option number)
or `"reply": "Australia"` (an option label) instead of `option_id`.

Response `201`:

```json
{
  "vote":   { "id": "…", "option_id": "…", "voter_id": "…", "channel": "web" },
  "poll":   { "…": "…" },
  "total_votes": 12,
  "votes_by_channel": { "web": 10, "telegram": 2 },
  "results": [
    { "option_id": "…", "label": "India", "votes": 9, "percentage": 75, "leading": true }
  ]
}
```

Errors use one shape everywhere: `{ "error": { "code", "message", … } }`.
Vote rejections (`already_voted`, `poll_closed`, `poll_not_live`,
`rate_limited`) also carry `results`, so a client that loses a vote race can
still show the scoreboard without a second request.

## Double-vote prevention

Two layers:

1. **Primary — identity.** A unique index on `(poll_id, channel, voter_id)`.
   The web app generates a device id once and keeps it in `localStorage`;
   `channel` is part of the key so a Telegram user id can never collide with a
   browser device id.
2. **Backup — network.** Votes per poll from one IP are capped at
   `MAX_VOTES_PER_IP_PER_POLL` (default 40) and the IP is stored only as a
   salted SHA-256 hash. This is deliberately a generous ceiling rather than a
   one-vote-per-IP rule: a whole stand shares a single stadium NAT address, so
   a strict rule would lock out most of the ground.

Neither layer stops a determined user clearing their storage — that is the
usual trade-off for a no-login poll.

## Realtime

`ws://localhost:4000/ws`

```json
→ { "type": "subscribe", "poll_id": "…" }     // "*" for every poll
← { "type": "results", "poll_id": "…", "results": { … } }
← { "type": "poll_created" | "poll_updated" | "poll_closed", "poll": { … } }
```

The web app also refetches on a 3s timer, so a dropped socket degrades to
slower updates rather than a stale screen.

## Structure

```
src/
  channels/       channel adapters — the only place a surface may differ
  db/             SQLite connection + schema.sql
  lib/            ids, IP hashing, error types
  middleware/     single-password admin auth
  realtime/       WebSocket hub
  repositories/   all SQL lives here
  routes/         HTTP layer (public + admin)
  services/       validation, poll lifecycle, vote rules
```

Adding a channel is one line in `src/channels/index.js` — see
[`../bots/README.md`](../bots/README.md).

## Scheduled close

A poll with `closes_at` in the past is closed the next time it is read. No cron
job or background worker to keep alive.
