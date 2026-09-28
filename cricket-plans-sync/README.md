# Cricket Plans → n8n webhook sync

Drop-in module implementing the integration spec: two separate endpoints, attachments
first, plan JSON after, failures queued and retried. No framework, no dependencies —
one ES module file (`n8nPlanSync.js`) you can copy into the app as-is.

## Wiring it in

```js
import { createPlanSync } from './n8nPlanSync.js';

const planSync = createPlanSync({
  environment: 'test',      // swap to 'production' when Stephanie confirms the switch
  onQueueChange: (queue) => showPendingBadge(queue.length),
});

planSync.startAutoFlush();  // retries everything queued when the network comes back
planSync.flushQueue();      // and once on app start
```

In the existing save handler, after the plan has been written locally:

```js
const attachments = ['exercise1', 'exercise2', 'exercise3']
  .filter((slot) => plan.attachments?.[slot]?.isNewOrChanged)
  .map((slot) => ({
    slot,
    fileName: plan.attachments[slot].file.name,  // original name incl. extension
    file: plan.attachments[slot].file,           // File / Blob / Uint8Array
  }));

const result = await planSync.syncPlanSave(plan, attachments);

if (result.ok) {
  showSentToSharePoint(result.fileName);         // existing confirmation
} else {
  showQueuedForLater();                          // existing offline-queue messaging
}
```

That single call does the whole sequence from the spec: each attachment uploaded and
awaited one at a time, then the plan POST once every one has returned, success or
failure. A plan with no attachments just skips to the plan POST.

## What it guarantees

| Spec requirement | How it's met |
| --- | --- |
| Two separate endpoints | `uploadAttachment` and `sendPlanSaved`, never merged |
| Raw bytes, no multipart, no base64-in-JSON | body is a `Uint8Array`, `Content-Type` is the file's real MIME type (falls back to an extension lookup) |
| `planId` / `slot` / `fileName` query params | built by `attachmentUrl`; `slot` is validated against the three allowed values |
| Attachments before the plan, never concurrent | sequential `for await` loop, plan POST after it |
| Attachment failure doesn't block the save | failure is queued, loop continues, plan POST still fires |
| Flat plan JSON, no omitted keys | `normalizePlan` emits all 19 keys in spec order, `""` for blanks, `minutes` as a number |
| Failures retried like the existing queue | persisted queue in `localStorage`, `flushQueue()` on reconnect/startup |

The queue also treats a `200` with `ok: false` as a failure (that's what a broken
SharePoint credential in n8n looks like), keeps one entry per `planId`+`slot` so a
re-save supersedes a stale queued file, retries attachments before their plan, and
gives up after 8 attempts.

## Test → production switch

Only the base path changes:

```js
createPlanSync({ environment: 'production' })
// https://alsamaproject.app.n8n.cloud/webhook/...
```

Until Stephanie confirms the workflow is live, `'test'` is the only one that responds,
and only while the n8n editor is open — don't ship the production build pointed at it.
Best handled by reading the environment from the app's existing build config rather
than hardcoding, so the switch is a config change, not a code change.

## Notes / caveats

- **Queued attachments are held base64-encoded in `localStorage`.** That's storage only,
  never transport — a retry still uploads raw bytes. `localStorage` caps at ~5 MB, so if
  coaches queue large videos offline, move the queue to IndexedDB; the storage interface
  is pluggable (`createPlanSync({ storage })`), so it's a contained change.
- **CORS**: the n8n webhook must return `Access-Control-Allow-Origin` for the app's
  origin, and allow `Content-Type` on preflight — a raw-bytes POST with e.g.
  `video/mp4` triggers a preflight. Worth checking with Stephanie before testing from
  the browser.
- The manual Excel export and the existing local-first save are untouched; this is
  purely additive.

## Tests

```
node --test cricket-plans-sync/*.test.mjs
```

10 tests, no dependencies — `fetch` and storage are stubbed. They cover the call order,
the raw-byte body, the queue-on-failure paths and the flush ordering.
