# Bots — Phase 2 (stub, not built)

**Status: not implemented.** This folder is deliberately empty of running code.
It documents the extension points that already exist in the backend so a
WhatsApp or Telegram bot can be added without touching the web app.

## What already works today

The backend is channel-agnostic, so the bot-facing pieces are live:

- `channel=whatsapp` and `channel=telegram` are **registered and accepted** by
  the vote endpoint right now — try the curl calls below against a running API.
- Those channels return **plain-text renderings** (numbered options, text bar
  charts) instead of JSON meant for a chart, via
  [`ChatChannelAdapter`](../backend/src/channels/chatChannel.js).
- Chat replies resolve to options: `"reply": "2"` (1-based number) or
  `"reply": "Australia"` (option label, case-insensitive).
- Voter ids are namespaced per channel (`tg:12345`, `wa:447700900000`), so a
  Telegram user id can never collide with a browser device id.

## What is missing

Only the **transport**: a process that receives platform webhooks, calls the
API, and sends the reply back. No API change is needed for it.

```
┌──────────────┐   webhook    ┌───────────────┐   HTTP    ┌─────────────────┐
│ WhatsApp /   │─────────────▶│  bot process  │──────────▶│ Cricket Polls   │
│ Telegram     │◀─────────────│  (this folder)│◀──────────│ API (unchanged) │
└──────────────┘  send reply  └───────────────┘  results  └─────────────────┘
```

The bot process is responsible for exactly three things:

1. **Verify** the webhook (Telegram secret token, WhatsApp `X-Hub-Signature-256`).
2. **Translate** the inbound message into one API call.
3. **Send** the `text` field from the API response back to the chat.

## The flow

### 1. Someone asks what is open

```bash
curl http://localhost:4000/api/polls/live -H 'x-channel: telegram'
```

Each poll comes back with a chat-ready `text`:

```
🏏 India vs Australia · 2nd ODI
*Who wins the toss?*

1. India
2. Australia

Reply with a number to vote.
```

Send that text; remember the `poll.id` against the chat id so the next reply
can be attributed (a small key–value store, or the platform's own reply
metadata — the API does not hold conversation state).

### 2. They reply "2"

```bash
curl -X POST http://localhost:4000/api/polls/<POLL_ID>/vote \
  -H 'Content-Type: application/json' \
  -d '{
        "reply":    "2",
        "voter_id": "12345",
        "channel":  "telegram"
      }'
```

`voter_id` is the platform's own user id — a Telegram `message.from.id`, or the
WhatsApp sender's phone number. Do not invent one, and do not use the chat/group
id: the adapter namespaces what you send, and the double-vote guard is keyed on
it.

### 3. Reply with the results

The vote response already contains the rendered board:

```json
{
  "vote": { "voter_id": "tg:12345", "option_id": "…", "channel": "telegram" },
  "text": "*Who wins the toss?*\n\n████████░░ 78%  India (14)\n██░░░░░░░░ 22%  Australia (4)\n\n18 votes · voting open",
  "total_votes": 18,
  "results": [ … ]
}
```

Send `text` back. That is the whole happy path.

### 4. Handle the four rejections

Every error is `{ "error": { "code", "message", … } }`, and vote rejections
also carry `results`, so there is always something worth replying with:

| `code` | HTTP | What the bot should say |
| --- | --- | --- |
| `already_voted` | 409 | "You already voted." + `error.results` board |
| `poll_closed` | 409 | "Voting has finished." + final board |
| `poll_not_live` | 409 | "That poll isn't open yet." |
| `bad_request` | 400 | Re-send the options — `error.options` lists them |
| `rate_limited` | 429 | "Too many votes from this network." |

## Adding a channel properly

If a new surface needs different identity or formatting rules, subclass the
adapter rather than special-casing a route:

```js
// backend/src/channels/discordChannel.js
import { ChatChannelAdapter } from './chatChannel.js';

export class DiscordChannelAdapter extends ChatChannelAdapter {
  constructor() {
    super({ name: 'discord', idPrefix: 'dc' });
  }
}
```

```js
// backend/src/channels/index.js — one line
registerChannel(new DiscordChannelAdapter());
```

Routes, services and SQL stay untouched. See
[`channelAdapter.js`](../backend/src/channels/channelAdapter.js) for the full
contract.

## Suggested layout when this gets built

```
bots/
  shared/
    pollsClient.js     thin wrapper over the API (fetch + error mapping)
    conversation.js    chat id -> poll id, so a bare "2" can be attributed
  telegram/
    index.js           webhook server, verifies the secret token
  whatsapp/
    index.js           webhook server, verifies X-Hub-Signature-256
```

Keep the API client in `shared/` so both bots — and the mobile app later — map
the same error codes to the same user-facing messages.

## Live results without polling

Bots that want to push an updated board when the numbers move can subscribe to
the same WebSocket the web scoreboard uses:

```js
socket.send(JSON.stringify({ type: 'subscribe', poll_id: pollId })); // '*' for all
// ← { "type": "results",     "poll_id": "…", "results": { … } }
// ← { "type": "poll_closed", "poll_id": "…", "poll": { … } }
```

Be careful about rate limits: edit one pinned message rather than sending a new
one on every vote.

## Things not to do

- **Don't add a bot-only endpoint.** If a bot needs something the web app
  doesn't, it belongs in an adapter, not a new route.
- **Don't send the admin password to a bot.** Poll creation stays with the
  single admin; bots are read-and-vote only.
- **Don't hold poll state in the bot.** The API is the only source of truth for
  what is open and what the tally is.
