import { getDb } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';

/**
 * All SQL lives here. Nothing above this layer writes a query, and nothing in
 * this layer knows which channel a request arrived on.
 */

function rowToPoll(row, options) {
  return {
    id: row.id,
    question: row.question,
    match_name: row.match_name,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closes_at: row.closes_at,
    closed_at: row.closed_at,
    options,
  };
}

function optionsFor(pollIds) {
  if (pollIds.length === 0) return new Map();
  const db = getDb();
  const placeholders = pollIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, poll_id, label, position
         FROM poll_options
        WHERE poll_id IN (${placeholders})
        ORDER BY poll_id, position`,
    )
    .all(...pollIds);

  const grouped = new Map(pollIds.map((id) => [id, []]));
  for (const row of rows) {
    grouped.get(row.poll_id)?.push({ id: row.id, label: row.label, position: row.position });
  }
  return grouped;
}

export function createPoll({ question, matchName, status, closesAt, options }) {
  const db = getDb();
  const id = newId();
  const timestamp = nowIso();

  const insertPoll = db.prepare(
    `INSERT INTO polls (id, question, match_name, status, created_at, updated_at, closes_at)
     VALUES (@id, @question, @matchName, @status, @timestamp, @timestamp, @closesAt)`,
  );
  const insertOption = db.prepare(
    `INSERT INTO poll_options (id, poll_id, label, position)
     VALUES (@id, @pollId, @label, @position)`,
  );

  db.transaction(() => {
    insertPoll.run({ id, question, matchName, status, timestamp, closesAt });
    options.forEach((label, position) => {
      insertOption.run({ id: newId(), pollId: id, label, position });
    });
  })();

  return findPollById(id);
}

/**
 * Patches poll fields. When `options` is supplied the option set is replaced,
 * which is only safe before any vote is cast -- the service layer enforces that.
 */
export function updatePoll(id, { question, matchName, status, closesAt, options }) {
  const db = getDb();
  const insertOption = db.prepare(
    `INSERT INTO poll_options (id, poll_id, label, position)
     VALUES (@id, @pollId, @label, @position)`,
  );

  db.transaction(() => {
    db.prepare(
      `UPDATE polls
          SET question   = COALESCE(@question, question),
              match_name = COALESCE(@matchName, match_name),
              status     = COALESCE(@status, status),
              closes_at  = CASE WHEN @closesAtProvided = 1 THEN @closesAt ELSE closes_at END,
              updated_at = @timestamp
        WHERE id = @id`,
    ).run({
      id,
      question: question ?? null,
      matchName: matchName ?? null,
      status: status ?? null,
      closesAt: closesAt ?? null,
      closesAtProvided: closesAt === undefined ? 0 : 1,
      timestamp: nowIso(),
    });

    if (options) {
      db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(id);
      options.forEach((label, position) => {
        insertOption.run({ id: newId(), pollId: id, label, position });
      });
    }
  })();

  return findPollById(id);
}

export function findPollById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM polls WHERE id = ?').get(id);
  if (!row) return null;
  return rowToPoll(row, optionsFor([id]).get(id) ?? []);
}

export function listPolls({ status, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const statuses = status ? [].concat(status) : null;

  const where = statuses ? `WHERE status IN (${statuses.map(() => '?').join(', ')})` : '';
  const params = statuses ? [...statuses, limit, offset] : [limit, offset];

  const rows = db
    .prepare(
      `SELECT * FROM polls
        ${where}
        ORDER BY COALESCE(closed_at, created_at) DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params);

  const grouped = optionsFor(rows.map((row) => row.id));
  return rows.map((row) => rowToPoll(row, grouped.get(row.id) ?? []));
}

export function setPollStatus(id, status) {
  const db = getDb();
  const timestamp = nowIso();
  db.prepare(
    `UPDATE polls
        SET status = @status,
            updated_at = @timestamp,
            closed_at = CASE WHEN @status = 'closed' THEN @timestamp ELSE NULL END
      WHERE id = @id`,
  ).run({ id, status, timestamp });
  return findPollById(id);
}

export function deletePoll(id) {
  const db = getDb();
  return db.prepare('DELETE FROM polls WHERE id = ?').run(id).changes > 0;
}

export function findOption(pollId, optionId) {
  return (
    getDb()
      .prepare('SELECT id, poll_id, label, position FROM poll_options WHERE id = ? AND poll_id = ?')
      .get(optionId, pollId) ?? null
  );
}

export function insertVote({ pollId, optionId, voterId, channel, ipHash }) {
  const vote = {
    id: newId(),
    pollId,
    optionId,
    voterId,
    channel,
    ipHash: ipHash ?? null,
    createdAt: nowIso(),
  };
  getDb().prepare(
    `INSERT INTO votes (id, poll_id, option_id, voter_id, channel, ip_hash, created_at)
     VALUES (@id, @pollId, @optionId, @voterId, @channel, @ipHash, @createdAt)`,
  ).run(vote);
  return {
    id: vote.id,
    poll_id: pollId,
    option_id: optionId,
    voter_id: voterId,
    channel,
    created_at: vote.createdAt,
  };
}

export function findVote({ pollId, voterId, channel }) {
  return (
    getDb()
      .prepare(
        `SELECT id, poll_id, option_id, voter_id, channel, created_at
           FROM votes
          WHERE poll_id = ? AND voter_id = ? AND channel = ?`,
      )
      .get(pollId, voterId, channel) ?? null
  );
}

export function countVotesByIp({ pollId, ipHash }) {
  if (!ipHash) return 0;
  return getDb()
    .prepare('SELECT COUNT(*) AS total FROM votes WHERE poll_id = ? AND ip_hash = ?')
    .get(pollId, ipHash).total;
}

/** Per-option tallies for a poll, including options that nobody picked. */
export function tallyPoll(pollId) {
  const rows = getDb()
    .prepare(
      `SELECT o.id, o.label, o.position, COUNT(v.id) AS votes
         FROM poll_options o
         LEFT JOIN votes v ON v.option_id = o.id
        WHERE o.poll_id = ?
        GROUP BY o.id
        ORDER BY o.position`,
    )
    .all(pollId);
  return rows.map((row) => ({
    option_id: row.id,
    label: row.label,
    position: row.position,
    votes: row.votes,
  }));
}

/** Vote counts per channel -- the distribution view Phase 2 will care about. */
export function tallyByChannel(pollId) {
  const rows = getDb()
    .prepare('SELECT channel, COUNT(*) AS total FROM votes WHERE poll_id = ? GROUP BY channel')
    .all(pollId);
  return Object.fromEntries(rows.map((row) => [row.channel, row.total]));
}
