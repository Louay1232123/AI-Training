import * as repo from '../repositories/pollRepository.js';
import { getChannel } from '../channels/index.js';
import { config, POLL_STATUSES } from '../config.js';
import { hashIp } from '../lib/ids.js';
import { badRequest, conflict, notFound, tooManyRequests } from '../lib/errors.js';

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

/* ------------------------------------------------------------------ input */

function cleanText(value, { field, max, required = true }) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    if (required) throw badRequest(`"${field}" is required.`);
    return '';
  }
  if (text.length > max) throw badRequest(`"${field}" must be ${max} characters or fewer.`);
  return text;
}

function cleanOptions(value) {
  if (!Array.isArray(value)) throw badRequest('"options" must be an array of labels.');
  const labels = value
    .map((option) => (typeof option === 'string' ? option : option?.label))
    .map((label) => (typeof label === 'string' ? label.trim() : ''))
    .filter(Boolean);

  if (labels.length < MIN_OPTIONS) {
    throw badRequest(`A poll needs at least ${MIN_OPTIONS} options.`);
  }
  if (labels.length > MAX_OPTIONS) {
    throw badRequest(`A poll can have at most ${MAX_OPTIONS} options.`);
  }
  if (labels.some((label) => label.length > 80)) {
    throw badRequest('Each option must be 80 characters or fewer.');
  }
  const seen = new Set(labels.map((label) => label.toLowerCase()));
  if (seen.size !== labels.length) throw badRequest('Options must be unique.');
  return labels;
}

function cleanClosesAt(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest('"closes_at" must be an ISO 8601 timestamp or null.');
  }
  return date.toISOString();
}

function cleanStatus(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest('"status" is required.');
    return undefined;
  }
  if (!POLL_STATUSES.includes(value)) {
    throw badRequest(`"status" must be one of: ${POLL_STATUSES.join(', ')}.`);
  }
  return value;
}

/* ------------------------------------------------------------- lifecycle */

const isExpired = (poll) =>
  poll.status === 'live' && poll.closes_at !== null && new Date(poll.closes_at) <= new Date();

/**
 * Closes any live poll whose `closes_at` has passed. Called on every read so a
 * scheduled close happens without a background worker -- one less moving part
 * for a channel to depend on.
 */
function settleExpiry(poll) {
  if (!poll) return poll;
  return isExpired(poll) ? repo.setPollStatus(poll.id, 'closed') : poll;
}

function settleExpiryAll(polls) {
  return polls.map((poll) => settleExpiry(poll));
}

/* ----------------------------------------------------------------- admin */

export function createPoll(input = {}) {
  const status = cleanStatus(input.status) ?? 'live';
  if (status === 'closed') {
    throw badRequest('A new poll cannot be created as "closed".');
  }

  return repo.createPoll({
    question: cleanText(input.question, { field: 'question', max: 280 }),
    matchName: cleanText(input.match_name, { field: 'match_name', max: 120, required: false }),
    status,
    closesAt: cleanClosesAt(input.closes_at) ?? null,
    options: cleanOptions(input.options),
  });
}

export function updatePoll(id, input = {}) {
  const poll = getPollOrThrow(id);
  if (poll.status === 'closed') {
    throw conflict('poll_closed', 'A closed poll cannot be edited.');
  }

  const patch = {};
  if (input.question !== undefined) {
    patch.question = cleanText(input.question, { field: 'question', max: 280 });
  }
  if (input.match_name !== undefined) {
    patch.matchName = cleanText(input.match_name, {
      field: 'match_name',
      max: 120,
      required: false,
    });
  }
  if (input.status !== undefined) patch.status = cleanStatus(input.status, { required: true });
  if (input.closes_at !== undefined) patch.closesAt = cleanClosesAt(input.closes_at);

  if (input.options !== undefined) {
    // Replacing options would orphan existing tallies, so it is only allowed
    // while the poll has no votes.
    if (countVotes(id) > 0) {
      throw conflict(
        'poll_has_votes',
        'Options cannot be changed once voting has started. Close this poll and create a new one.',
      );
    }
    patch.options = cleanOptions(input.options);
  }

  if (patch.status === 'closed') return repo.setPollStatus(id, 'closed');
  return repo.updatePoll(id, patch);
}

export function closePoll(id) {
  const poll = getPollOrThrow(id);
  if (poll.status === 'closed') return poll;
  return repo.setPollStatus(id, 'closed');
}

export function openPoll(id) {
  getPollOrThrow(id);
  return repo.setPollStatus(id, 'live');
}

export function deletePoll(id) {
  getPollOrThrow(id);
  return repo.deletePoll(id);
}

/** Admin view: every poll in any state, newest first. */
export const listAllPolls = ({ limit, offset } = {}) =>
  settleExpiryAll(repo.listPolls({ limit, offset }));

/* ---------------------------------------------------------------- public */

export const getLivePolls = () =>
  settleExpiryAll(repo.listPolls({ status: 'live' })).filter((poll) => poll.status === 'live');

export const getPollHistory = ({ limit, offset } = {}) =>
  repo.listPolls({ status: 'closed', limit, offset });

export function getPoll(id) {
  return settleExpiry(repo.findPollById(id));
}

function getPollOrThrow(id) {
  const poll = getPoll(id);
  if (!poll) throw notFound(`No poll with id "${id}".`);
  return poll;
}

const countVotes = (pollId) =>
  repo.tallyPoll(pollId).reduce((total, row) => total + row.votes, 0);

/**
 * Results for a poll. Percentages are rounded to one decimal place and always
 * computed server-side so every channel shows the same numbers.
 */
export function getResults(id) {
  const poll = getPollOrThrow(id);
  const tally = repo.tallyPoll(id);
  const total = tally.reduce((sum, row) => sum + row.votes, 0);
  const leaderVotes = tally.reduce((max, row) => Math.max(max, row.votes), 0);

  return {
    poll,
    total_votes: total,
    votes_by_channel: repo.tallyByChannel(id),
    results: tally.map((row) => ({
      option_id: row.option_id,
      label: row.label,
      position: row.position,
      votes: row.votes,
      percentage: total === 0 ? 0 : Math.round((row.votes / total) * 1000) / 10,
      // Flagged server-side so a scoreboard can highlight the front-runner
      // without re-deriving it (and ties highlight together).
      leading: total > 0 && row.votes === leaderVotes,
    })),
    generated_at: new Date().toISOString(),
  };
}

/**
 * Records a vote. Channel-agnostic: the adapter resolves who is voting and
 * which option they meant, everything after that is identical for every surface.
 *
 * @param {object} params
 * @param {string} params.pollId
 * @param {string} [params.channel='web']
 * @param {object} [params.context] channel-native request context
 */
export function castVote({ pollId, channel = 'web', context = {} }) {
  const adapter = getChannel(channel);
  const poll = getPollOrThrow(pollId);

  if (poll.status !== 'live') {
    throw conflict(
      poll.status === 'closed' ? 'poll_closed' : 'poll_not_live',
      poll.status === 'closed'
        ? 'This poll is closed. Voting has finished.'
        : 'This poll is not open for voting yet.',
      { results: getResults(pollId) },
    );
  }

  const { voterId, ip } = adapter.resolveVoter(context);
  const { optionId } = adapter.resolveOption({ ...context, poll });

  if (!optionId) {
    throw badRequest('An "option_id" is required.', {
      options: poll.options.map(({ id, label }) => ({ id, label })),
    });
  }
  if (!repo.findOption(pollId, optionId)) {
    throw badRequest(`Option "${optionId}" does not belong to this poll.`, {
      options: poll.options.map(({ id, label }) => ({ id, label })),
    });
  }

  // Primary guard: one vote per identity per poll.
  const existing = repo.findVote({ pollId, voterId, channel: adapter.name });
  if (existing) {
    throw conflict('already_voted', 'You have already voted in this poll.', {
      vote: existing,
      results: getResults(pollId),
    });
  }

  // Backup guard: cap votes from one network. Generous on purpose -- a whole
  // stand shares a single stadium NAT address.
  const ipHash = hashIp(ip);
  if (ipHash && repo.countVotesByIp({ pollId, ipHash }) >= config.maxVotesPerIpPerPoll) {
    throw tooManyRequests('Too many votes from this network on this poll.', {
      results: getResults(pollId),
    });
  }

  let vote;
  try {
    vote = repo.insertVote({ pollId, optionId, voterId, channel: adapter.name, ipHash });
  } catch (error) {
    // Two requests from the same device landing at once: the unique index wins.
    if (String(error.code).startsWith('SQLITE_CONSTRAINT')) {
      throw conflict('already_voted', 'You have already voted in this poll.', {
        vote: repo.findVote({ pollId, voterId, channel: adapter.name }),
        results: getResults(pollId),
      });
    }
    throw error;
  }

  return { vote, results: getResults(pollId) };
}

/** Has this identity already voted? Lets any channel render state before voting. */
export function findExistingVote({ pollId, channel = 'web', context = {} }) {
  const adapter = getChannel(channel);
  const { voterId } = adapter.resolveVoter(context);
  return repo.findVote({ pollId, voterId, channel: adapter.name });
}
