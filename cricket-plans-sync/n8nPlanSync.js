/**
 * Cricket Plans -> n8n webhook sync.
 *
 * Implements the two-endpoint integration:
 *   1. POST /alsama-plan-attachment?planId&slot&fileName  (raw file bytes)
 *   2. POST /alsama-plan-saved                            (flat plan JSON)
 *
 * Attachments upload first, sequentially; the plan POST fires only once every
 * attachment for that save has returned (success or failure). Failures go into
 * a persisted queue and are retried later, exactly like the existing plan-sync
 * offline queue — they never block the plan save.
 *
 * No framework, no dependencies. Works in any browser with fetch + localStorage.
 */

export const N8N_BASE_URLS = {
  // Only responds while the n8n editor is open. Never point production here.
  test: 'https://alsamaproject.app.n8n.cloud/webhook-test',
  // Live once Stephanie activates the workflow. Same paths, nothing else changes.
  production: 'https://alsamaproject.app.n8n.cloud/webhook',
};

export const ATTACHMENT_SLOTS = ['exercise1', 'exercise2', 'exercise3'];

/** Plan fields in the order the spec lists them. `minutes` is the only number. */
export const PLAN_STRING_FIELDS = [
  'id',
  'weekStarting',
  'date',
  'day',
  'start',
  'end',
  'level',
  'type',
  'objective',
  'warmUp',
  'exercise1',
  'exercise2',
  'exercise3',
  'match',
  'sideTraining',
  'equipment',
  'notes',
  'savedAt',
];

const QUEUE_KEY = 'alsama.n8nSyncQueue.v1';
const MAX_ATTEMPTS = 8;

/**
 * Build the plan body the webhook expects: flat, every key present, empty
 * string for anything not filled in, `minutes` coerced to a number.
 */
export function normalizePlan(plan) {
  const body = {};
  for (const field of PLAN_STRING_FIELDS) {
    const value = plan[field];
    body[field] = value === undefined || value === null ? '' : String(value);
  }
  const minutes = Number(plan.minutes);
  body.minutes = Number.isFinite(minutes) ? minutes : 0;

  // Keep the spec's field order (minutes sits between `end` and `level`).
  const ordered = {};
  for (const field of PLAN_STRING_FIELDS) {
    if (field === 'level') ordered.minutes = body.minutes;
    ordered[field] = body[field];
  }
  return ordered;
}

export function attachmentUrl(baseUrl, { planId, slot, fileName }) {
  if (!planId) throw new Error('attachment upload needs a planId');
  if (!ATTACHMENT_SLOTS.includes(slot)) {
    throw new Error(`slot must be one of ${ATTACHMENT_SLOTS.join(', ')} (got "${slot}")`);
  }
  if (!fileName) throw new Error('attachment upload needs the original fileName');
  const query = new URLSearchParams({ planId, slot, fileName });
  return `${baseUrl}/alsama-plan-attachment?${query}`;
}

export function planSavedUrl(baseUrl) {
  return `${baseUrl}/alsama-plan-saved`;
}

/** Last-resort MIME guess when a File/Blob arrives without a type. */
function guessContentType(fileName) {
  const ext = String(fileName).split('.').pop().toLowerCase();
  const types = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
  };
  return types[ext] || 'application/octet-stream';
}

function browserStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.getItem(QUEUE_KEY);
    return localStorage;
  } catch {
    return null; // private mode / blocked storage — queue stays in memory
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

async function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function toBytes(file) {
  if (file instanceof Uint8Array) return file;
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  if (typeof file?.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  throw new Error('attachment must be a File, Blob, ArrayBuffer or Uint8Array');
}

/**
 * @param {object} options
 * @param {'test'|'production'|string} [options.environment] - key of N8N_BASE_URLS
 * @param {string} [options.baseUrl] - explicit base URL, wins over environment
 * @param {typeof fetch} [options.fetch]
 * @param {Storage} [options.storage] - defaults to localStorage, falls back to memory
 * @param {(queue: object[]) => void} [options.onQueueChange]
 * @param {(event: object) => void} [options.onEvent] - logging hook
 */
export function createPlanSync(options = {}) {
  const baseUrl = (options.baseUrl || N8N_BASE_URLS[options.environment || 'test'] || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('createPlanSync needs a baseUrl or a known environment');

  const doFetch = options.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error('no fetch implementation available');

  const storage = options.storage || browserStorage() || memoryStorage();
  const onQueueChange = options.onQueueChange || (() => {});
  const emit = options.onEvent || (() => {});

  function readQueue() {
    try {
      const raw = storage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function writeQueue(queue) {
    try {
      storage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (error) {
      emit({ type: 'queue-write-failed', error: String(error) });
    }
    onQueueChange(queue);
  }

  function enqueue(item) {
    const queue = readQueue();
    // One pending entry per attachment slot, and one per plan — a later save
    // supersedes an earlier queued version of the same thing.
    const isSame = (q) =>
      q.kind === item.kind &&
      q.planId === item.planId &&
      (item.kind !== 'attachment' || q.slot === item.slot);
    const next = queue.filter((q) => !isSame(q));
    next.push({ ...item, attempts: 0, queuedAt: new Date().toISOString() });
    writeQueue(next);
    emit({ type: 'queued', kind: item.kind, planId: item.planId, slot: item.slot });
  }

  async function parseJson(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`webhook returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
    }
  }

  /** Endpoint 1 — raw bytes, no multipart, no base64-in-JSON. */
  async function uploadAttachment({ planId, slot, fileName, file, contentType }) {
    const bytes = await toBytes(file);
    const url = attachmentUrl(baseUrl, { planId, slot, fileName });
    const type = contentType || file?.type || guessContentType(fileName);

    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: bytes,
    });
    if (!response.ok) throw new Error(`attachment upload failed (${response.status})`);

    const json = await parseJson(response);
    if (json.ok !== true) throw new Error(`attachment upload rejected: ${JSON.stringify(json)}`);
    return json; // { ok: true, url: 'https://alsamango.sharepoint.com/...' }
  }

  /** Endpoint 2 — the flat plan JSON. */
  async function sendPlanSaved(plan) {
    const body = normalizePlan(plan);
    const response = await doFetch(planSavedUrl(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`plan save webhook failed (${response.status})`);

    const json = await parseJson(response);
    if (json.ok !== true) throw new Error(`plan save rejected: ${JSON.stringify(json)}`);
    return json; // { ok: true, fileName: 'U12 - Week of 2026-09-21 - Wednesday.xlsx' }
  }

  /**
   * The whole per-save sequence.
   *
   * @param {object} plan - the plan object (any shape; normalized here)
   * @param {Array} attachments - [{ slot, fileName, file, contentType? }] for
   *        slots with a new or changed picture/video. Unchanged ones stay out.
   * @returns {Promise<{ ok, fileName?, attachments, queued, error? }>}
   */
  async function syncPlanSave(plan, attachments = []) {
    const planId = plan.id;
    if (!planId) throw new Error('plan.id is required — it is the planId the webhooks key on');

    const results = [];
    // Sequential on purpose: never concurrent with each other or with endpoint 2.
    for (const attachment of attachments) {
      try {
        const json = await uploadAttachment({ planId, ...attachment });
        results.push({ slot: attachment.slot, ok: true, url: json.url });
        emit({ type: 'attachment-uploaded', planId, slot: attachment.slot, url: json.url });
      } catch (error) {
        results.push({ slot: attachment.slot, ok: false, error: String(error) });
        emit({ type: 'attachment-failed', planId, slot: attachment.slot, error: String(error) });
        enqueue({
          kind: 'attachment',
          planId,
          slot: attachment.slot,
          fileName: attachment.fileName,
          contentType: attachment.contentType || attachment.file?.type || guessContentType(attachment.fileName),
          base64: await bytesToBase64(await toBytes(attachment.file)),
        });
      }
    }

    // Every attachment has returned (ok or queued) — now the plan.
    try {
      const json = await sendPlanSaved(plan);
      emit({ type: 'plan-saved', planId, fileName: json.fileName });
      return {
        ok: true,
        fileName: json.fileName,
        attachments: results,
        queued: results.some((r) => !r.ok),
      };
    } catch (error) {
      enqueue({ kind: 'plan', planId, plan: normalizePlan(plan) });
      emit({ type: 'plan-save-failed', planId, error: String(error) });
      return { ok: false, error: String(error), attachments: results, queued: true };
    }
  }

  /**
   * Retry everything queued. Call on reconnect ('online'), on app start, and
   * wherever the existing offline queue already flushes.
   *
   * Attachments for a plan are retried before that plan's own entry, so the
   * Excel file is written with the links already in place where possible.
   */
  async function flushQueue() {
    const queue = readQueue();
    if (queue.length === 0) return { sent: 0, remaining: 0 };

    const ordered = [...queue].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'attachment' ? -1 : 1));
    const remaining = [];
    let sent = 0;

    for (const item of ordered) {
      try {
        if (item.kind === 'attachment') {
          await uploadAttachment({
            planId: item.planId,
            slot: item.slot,
            fileName: item.fileName,
            contentType: item.contentType,
            file: base64ToBytes(item.base64),
          });
        } else {
          await sendPlanSaved(item.plan);
        }
        sent++;
        emit({ type: 'flush-sent', kind: item.kind, planId: item.planId, slot: item.slot });
      } catch (error) {
        const attempts = (item.attempts || 0) + 1;
        emit({ type: 'flush-failed', kind: item.kind, planId: item.planId, attempts, error: String(error) });
        if (attempts < MAX_ATTEMPTS) remaining.push({ ...item, attempts, lastError: String(error) });
        else emit({ type: 'flush-abandoned', kind: item.kind, planId: item.planId, slot: item.slot });
      }
    }

    writeQueue(remaining);
    return { sent, remaining: remaining.length };
  }

  function pendingCount() {
    return readQueue().length;
  }

  function clearQueue() {
    writeQueue([]);
  }

  /** Flush on reconnect. Returns an unsubscribe function. */
  function startAutoFlush() {
    if (typeof window === 'undefined') return () => {};
    const handler = () => {
      flushQueue().catch((error) => emit({ type: 'flush-error', error: String(error) }));
    };
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }

  return {
    baseUrl,
    syncPlanSave,
    uploadAttachment,
    sendPlanSaved,
    flushQueue,
    pendingCount,
    clearQueue,
    startAutoFlush,
  };
}
