/**
 * End-to-end API tests. Run with: npm test
 * Uses an in-memory database and a real HTTP listener, so routes, middleware,
 * services and SQL are all exercised together.
 */
import './setup.js';

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createApp } from '../src/app.js';

const server = http.createServer(createApp());
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const admin = { Authorization: 'Bearer test-password', 'Content-Type': 'application/json' };

async function call(method, path, { body, headers } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const makePoll = (overrides = {}) =>
  call('POST', '/api/admin/polls', {
    headers: admin,
    body: {
      question: 'Who wins the toss?',
      match_name: 'IND vs AUS',
      options: ['India', 'Australia'],
      ...overrides,
    },
  });

test('health check responds', async () => {
  const { status, body } = await call('GET', '/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('admin endpoints reject a missing or wrong password', async () => {
  assert.equal((await call('GET', '/api/admin/polls')).status, 401);
  assert.equal(
    (await call('GET', '/api/admin/polls', { headers: { Authorization: 'Bearer nope' } })).status,
    401,
  );
  assert.equal((await call('GET', '/api/admin/polls', { headers: admin })).status, 200);
});

test('creating a poll returns ordered options and a live status', async () => {
  const { status, body } = await makePoll();
  assert.equal(status, 201);
  assert.equal(body.poll.status, 'live');
  assert.equal(body.poll.question, 'Who wins the toss?');
  assert.deepEqual(
    body.poll.options.map((option) => option.label),
    ['India', 'Australia'],
  );
});

test('poll creation validates question and options', async () => {
  assert.equal((await makePoll({ question: '   ' })).status, 400);
  assert.equal((await makePoll({ options: ['Only one'] })).status, 400);
  assert.equal((await makePoll({ options: ['Same', 'same'] })).status, 400);
  assert.equal((await makePoll({ status: 'closed' })).status, 400);
});

test('a vote is counted and percentages are computed server-side', async () => {
  const { body: created } = await makePoll();
  const pollId = created.poll.id;
  const optionId = created.poll.options[0].id;

  const { status, body } = await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: optionId, voter_id: 'device-1' },
  });

  assert.equal(status, 201);
  assert.equal(body.total_votes, 1);
  assert.equal(body.vote.channel, 'web');
  const india = body.results.find((row) => row.label === 'India');
  assert.equal(india.votes, 1);
  assert.equal(india.percentage, 100);
  assert.equal(india.leading, true);
});

test('the same device cannot vote twice in one poll', async () => {
  const { body: created } = await makePoll();
  const pollId = created.poll.id;

  const first = await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: created.poll.options[0].id, voter_id: 'repeat-device' },
  });
  assert.equal(first.status, 201);

  const second = await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: created.poll.options[1].id, voter_id: 'repeat-device' },
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'already_voted');
  // The rejection still carries results so the client can show the scoreboard.
  assert.equal(second.body.error.results.total_votes, 1);
});

test('the same raw id on a different channel is a different voter', async () => {
  const { body: created } = await makePoll();
  const pollId = created.poll.id;
  const optionId = created.poll.options[0].id;

  const web = await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: optionId, voter_id: '12345', channel: 'web' },
  });
  const telegram = await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: optionId, voter_id: '12345', channel: 'telegram' },
  });

  assert.equal(web.status, 201);
  assert.equal(telegram.status, 201);
  assert.equal(telegram.body.results.total_votes, 2);
});

test('a chat channel resolves a numeric reply to an option', async () => {
  const { body: created } = await makePoll();
  const pollId = created.poll.id;

  const { status, body } = await call('POST', `/api/polls/${pollId}/vote`, {
    body: { reply: '2', voter_id: '4477000', channel: 'whatsapp' },
  });

  assert.equal(status, 201);
  assert.equal(body.vote.option_id, created.poll.options[1].id);
  assert.equal(body.vote.voter_id, 'wa:4477000');
  // Chat channels get text, not a chart.
  assert.match(body.text, /Australia/);
});

test('a chat channel resolves an option typed by name', async () => {
  const { body: created } = await makePoll();
  const { status, body } = await call('POST', `/api/polls/${created.poll.id}/vote`, {
    body: { reply: ' australia ', voter_id: '900', channel: 'telegram' },
  });
  assert.equal(status, 201);
  assert.equal(body.vote.option_id, created.poll.options[1].id);
});

test('an unrecognised reply is rejected with the option list', async () => {
  const { body: created } = await makePoll();
  const { status, body } = await call('POST', `/api/polls/${created.poll.id}/vote`, {
    body: { reply: 'maybe rain', voter_id: '901', channel: 'telegram' },
  });
  assert.equal(status, 400);
  assert.equal(body.error.options.length, 2);
});

test('votes are rejected for an unknown channel and a foreign option', async () => {
  const { body: created } = await makePoll();
  const { body: other } = await makePoll({ question: 'Other poll?' });

  const badChannel = await call('POST', `/api/polls/${created.poll.id}/vote`, {
    body: { option_id: created.poll.options[0].id, voter_id: 'd', channel: 'carrier-pigeon' },
  });
  assert.equal(badChannel.status, 400);

  const foreignOption = await call('POST', `/api/polls/${created.poll.id}/vote`, {
    body: { option_id: other.poll.options[0].id, voter_id: 'd2' },
  });
  assert.equal(foreignOption.status, 400);
});

test('voting requires a voter id', async () => {
  const { body: created } = await makePoll();
  const { status } = await call('POST', `/api/polls/${created.poll.id}/vote`, {
    body: { option_id: created.poll.options[0].id },
  });
  assert.equal(status, 400);
});

test('closing a poll blocks further votes and moves it to history', async () => {
  const { body: created } = await makePoll({ question: 'Man of the match?' });
  const pollId = created.poll.id;

  await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: created.poll.options[0].id, voter_id: 'early-bird' },
  });

  const closed = await call('POST', `/api/admin/polls/${pollId}/close`, { headers: admin });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.poll.status, 'closed');
  assert.ok(closed.body.poll.closed_at);

  const lateVote = await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: created.poll.options[0].id, voter_id: 'late-comer' },
  });
  assert.equal(lateVote.status, 409);
  assert.equal(lateVote.body.error.code, 'poll_closed');

  const live = await call('GET', '/api/polls/live');
  assert.equal(live.body.polls.some((poll) => poll.id === pollId), false);

  const history = await call('GET', '/api/polls/history');
  const inHistory = history.body.polls.find((poll) => poll.id === pollId);
  assert.ok(inHistory, 'closed poll should appear in history');
  assert.equal(inHistory.total_votes, 1);
});

test('a draft poll is not live and cannot be voted on until opened', async () => {
  const { body: created } = await makePoll({ status: 'draft', question: 'Draft poll?' });
  const pollId = created.poll.id;

  const live = await call('GET', '/api/polls/live');
  assert.equal(live.body.polls.some((poll) => poll.id === pollId), false);

  const blocked = await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: created.poll.options[0].id, voter_id: 'keen' },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'poll_not_live');

  await call('POST', `/api/admin/polls/${pollId}/open`, { headers: admin });
  const allowed = await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: created.poll.options[0].id, voter_id: 'keen' },
  });
  assert.equal(allowed.status, 201);
});

test('a poll past closes_at is settled on read', async () => {
  const { body: created } = await makePoll({
    question: 'Expired poll?',
    closes_at: new Date(Date.now() - 60_000).toISOString(),
  });

  const fetched = await call('GET', `/api/polls/${created.poll.id}`);
  assert.equal(fetched.body.poll.status, 'closed');

  const vote = await call('POST', `/api/polls/${created.poll.id}/vote`, {
    body: { option_id: created.poll.options[0].id, voter_id: 'too-slow' },
  });
  assert.equal(vote.status, 409);
});

test('options can be edited before votes but not after', async () => {
  const { body: created } = await makePoll({ question: 'Editable poll?' });
  const pollId = created.poll.id;

  const edited = await call('PATCH', `/api/admin/polls/${pollId}`, {
    headers: admin,
    body: { question: 'Edited question?', options: ['India', 'Australia', 'Draw'] },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.poll.question, 'Edited question?');
  assert.equal(edited.body.poll.options.length, 3);

  await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: edited.body.poll.options[0].id, voter_id: 'voter-x' },
  });

  const rejected = await call('PATCH', `/api/admin/polls/${pollId}`, {
    headers: admin,
    body: { options: ['A', 'B'] },
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error.code, 'poll_has_votes');

  // Editing the question alone is still fine.
  const questionOnly = await call('PATCH', `/api/admin/polls/${pollId}`, {
    headers: admin,
    body: { question: 'Still editable?' },
  });
  assert.equal(questionOnly.status, 200);
});

test('my-vote reports whether this device has voted', async () => {
  const { body: created } = await makePoll({ question: 'Checked poll?' });
  const pollId = created.poll.id;

  const before = await call('GET', `/api/polls/${pollId}/my-vote?voter_id=checker`);
  assert.equal(before.body.vote, null);

  await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: created.poll.options[0].id, voter_id: 'checker' },
  });

  const after = await call('GET', `/api/polls/${pollId}/my-vote?voter_id=checker`);
  assert.equal(after.body.vote.option_id, created.poll.options[0].id);
});

test('results split votes by channel', async () => {
  const { body: created } = await makePoll({ question: 'Channel split?' });
  const pollId = created.poll.id;
  const optionId = created.poll.options[0].id;

  await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: optionId, voter_id: 'w1', channel: 'web' },
  });
  await call('POST', `/api/polls/${pollId}/vote`, {
    body: { option_id: optionId, voter_id: 'a1', channel: 'app' },
  });

  const { body } = await call('GET', `/api/polls/${pollId}/results`);
  assert.deepEqual(body.votes_by_channel, { web: 1, app: 1 });
});

test('unknown polls and routes return 404', async () => {
  assert.equal((await call('GET', '/api/polls/does-not-exist')).status, 404);
  assert.equal((await call('GET', '/api/polls/does-not-exist/results')).status, 404);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

test('the registered channel list is discoverable', async () => {
  const { body } = await call('GET', '/api/channels');
  assert.deepEqual(body.channels.sort(), ['app', 'telegram', 'web', 'whatsapp']);
});

test('a deleted poll disappears', async () => {
  const { body: created } = await makePoll({ question: 'Doomed poll?' });
  const removed = await call('DELETE', `/api/admin/polls/${created.poll.id}`, { headers: admin });
  assert.equal(removed.status, 204);
  assert.equal((await call('GET', `/api/polls/${created.poll.id}`)).status, 404);
});
