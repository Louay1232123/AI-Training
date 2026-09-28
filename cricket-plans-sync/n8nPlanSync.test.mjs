/**
 * node --test cricket-plans-sync/n8nPlanSync.test.mjs
 * No dependencies — fetch and storage are stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlanSync, normalizePlan, attachmentUrl, N8N_BASE_URLS } from './n8nPlanSync.js';

const PLAN = {
  id: 'plan-abc123',
  weekStarting: '2026-09-21',
  date: '2026-09-23',
  day: 'Wednesday',
  start: '16:00',
  end: '17:30',
  minutes: 90,
  level: 'U12',
  type: 'Skills',
  objective: 'Front-foot drives against pace',
  warmUp: '10 min dynamic stretching + throwdowns',
  exercise1: 'Cover drive technique',
  exercise2: 'Footwork ladder',
  exercise3: 'Straight drive repetition',
  match: 'Optional 20-over scrimmage',
  sideTraining: 'Fielding — high catches',
  equipment: 'Cones, tennis balls, stumps',
  notes: 'Focus on balance through the shot',
  savedAt: '2026-09-22T12:00:00.000Z',
};

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function stubFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const result = await handler(url, init, calls.length);
    return {
      ok: result.status < 400,
      status: result.status,
      text: async () => JSON.stringify(result.body ?? {}),
    };
  };
  fn.calls = calls;
  return fn;
}

const ok = (body) => ({ status: 200, body });
const fail = () => ({ status: 500, body: { ok: false } });

function makeSync(fetchImpl, storage = memoryStorage()) {
  return { sync: createPlanSync({ environment: 'test', fetch: fetchImpl, storage }), storage };
}

test('normalizePlan fills missing fields and keeps minutes numeric', () => {
  const body = normalizePlan({ id: 'p1', minutes: '75' });
  assert.equal(body.minutes, 75);
  assert.equal(body.notes, '');
  assert.equal(Object.keys(body).length, 19);
  assert.equal(Object.keys(body)[6], 'minutes'); // after `end`, before `level`
});

test('attachment URL carries planId, slot and fileName', () => {
  const url = attachmentUrl(N8N_BASE_URLS.test, {
    planId: 'plan-abc123',
    slot: 'exercise1',
    fileName: 'cover drive.mp4',
  });
  assert.match(url, /\/webhook-test\/alsama-plan-attachment\?/);
  assert.match(url, /planId=plan-abc123/);
  assert.match(url, /slot=exercise1/);
  assert.match(url, /fileName=cover\+drive\.mp4/);
});

test('attachment slot is validated', () => {
  assert.throws(() => attachmentUrl(N8N_BASE_URLS.test, { planId: 'p', slot: 'exercise4', fileName: 'a.jpg' }));
});

test('attachments upload before the plan, sequentially, as raw bytes', async () => {
  const fetchImpl = stubFetch((url) =>
    url.includes('attachment') ? ok({ ok: true, url: 'https://sharepoint/x' }) : ok({ ok: true, fileName: 'U12.xlsx' })
  );
  const { sync } = makeSync(fetchImpl);

  const result = await sync.syncPlanSave(PLAN, [
    { slot: 'exercise1', fileName: 'cover-drive.mp4', file: new Uint8Array([1, 2, 3]), contentType: 'video/mp4' },
    { slot: 'exercise2', fileName: 'stance.jpg', file: new Uint8Array([4, 5]), contentType: 'image/jpeg' },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.fileName, 'U12.xlsx');
  assert.equal(fetchImpl.calls.length, 3);
  assert.match(fetchImpl.calls[0].url, /slot=exercise1/);
  assert.match(fetchImpl.calls[1].url, /slot=exercise2/);
  assert.match(fetchImpl.calls[2].url, /alsama-plan-saved$/);

  const [first] = fetchImpl.calls;
  assert.equal(first.init.headers['Content-Type'], 'video/mp4');
  assert.ok(first.init.body instanceof Uint8Array); // raw bytes, not multipart/base64

  const planBody = JSON.parse(fetchImpl.calls[2].init.body);
  assert.equal(planBody.minutes, 90);
  assert.equal(planBody.id, 'plan-abc123');
});

test('a failed attachment is queued and does not block the plan save', async () => {
  const fetchImpl = stubFetch((url) =>
    url.includes('attachment') ? fail() : ok({ ok: true, fileName: 'U12.xlsx' })
  );
  const { sync } = makeSync(fetchImpl);

  const result = await sync.syncPlanSave(PLAN, [
    { slot: 'exercise1', fileName: 'stance.jpg', file: new Uint8Array([1]), contentType: 'image/jpeg' },
  ]);

  assert.equal(result.ok, true); // plan still went through
  assert.equal(result.queued, true);
  assert.equal(sync.pendingCount(), 1);
});

test('a failed plan save is queued and replayed on flush', async () => {
  let online = false;
  const fetchImpl = stubFetch(() => (online ? ok({ ok: true, fileName: 'U12.xlsx' }) : fail()));
  const { sync } = makeSync(fetchImpl);

  const result = await sync.syncPlanSave(PLAN, []);
  assert.equal(result.ok, false);
  assert.equal(sync.pendingCount(), 1);

  online = true;
  const flushed = await sync.flushQueue();
  assert.deepEqual(flushed, { sent: 1, remaining: 0 });
  assert.equal(sync.pendingCount(), 0);
});

test('flush retries queued attachments before the queued plan', async () => {
  let online = false;
  const fetchImpl = stubFetch(() => (online ? ok({ ok: true, fileName: 'U12.xlsx', url: 'https://sp/x' }) : fail()));
  const { sync } = makeSync(fetchImpl);

  await sync.syncPlanSave(PLAN, [
    { slot: 'exercise3', fileName: 'drive.mp4', file: new Uint8Array([9]), contentType: 'video/mp4' },
  ]);
  assert.equal(sync.pendingCount(), 2);

  online = true;
  fetchImpl.calls.length = 0;
  await sync.flushQueue();

  assert.match(fetchImpl.calls[0].url, /attachment/);
  assert.match(fetchImpl.calls[1].url, /alsama-plan-saved$/);
  assert.equal(sync.pendingCount(), 0);
});

test('re-saving the same slot supersedes its queued attachment', async () => {
  const fetchImpl = stubFetch((url) => (url.includes('attachment') ? fail() : ok({ ok: true, fileName: 'x.xlsx' })));
  const { sync } = makeSync(fetchImpl);

  const attachment = { slot: 'exercise1', fileName: 'a.jpg', file: new Uint8Array([1]), contentType: 'image/jpeg' };
  await sync.syncPlanSave(PLAN, [attachment]);
  await sync.syncPlanSave(PLAN, [{ ...attachment, fileName: 'b.jpg', file: new Uint8Array([2]) }]);

  assert.equal(sync.pendingCount(), 1);
});

test('a 200 with ok:false is treated as a failure', async () => {
  const fetchImpl = stubFetch(() => ok({ ok: false, error: 'credential expired' }));
  const { sync } = makeSync(fetchImpl);
  const result = await sync.syncPlanSave(PLAN, []);
  assert.equal(result.ok, false);
  assert.equal(sync.pendingCount(), 1);
});

test('production environment swaps only the base path', () => {
  const sync = createPlanSync({ environment: 'production', fetch: stubFetch(() => ok({})), storage: memoryStorage() });
  assert.equal(sync.baseUrl, 'https://alsamaproject.app.n8n.cloud/webhook');
});
