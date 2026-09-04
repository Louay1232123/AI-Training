import { Router } from 'express';
import * as polls from '../services/pollService.js';
import { getChannel, listChannels } from '../channels/index.js';
import { broadcastResults } from '../realtime/hub.js';
import { notFound } from '../lib/errors.js';

/**
 * Public poll API. Every handler is channel-agnostic: the caller states which
 * channel it is (`channel` in the body or an `x-channel` header, default `web`)
 * and the matching adapter handles identity and rendering. A bot calls exactly
 * these endpoints -- there is no web-only path.
 */
export const pollsRouter = Router();

const channelOf = (req) => req.body?.channel ?? req.get('x-channel') ?? 'web';

/** Context handed to the adapter: everything channel-native about the request. */
const contextOf = (req) => ({
  body: req.body ?? {},
  headers: req.headers,
  ip: req.clientIp,
  voterId: req.body?.voter_id ?? req.get('x-device-id'),
  optionId: req.body?.option_id,
  optionRef: req.body?.option_ref ?? req.body?.reply,
});

pollsRouter.get('/channels', (_req, res) => {
  res.json({ channels: listChannels() });
});

// Live polls -- the home screen, and what a bot's "what's open?" command calls.
pollsRouter.get('/polls/live', (req, res) => {
  const adapter = getChannel(req.get('x-channel') ?? 'web');
  const live = polls.getLivePolls();
  res.json({ polls: live.map((poll) => adapter.renderPoll(poll)) });
});

// Closed polls with final results.
pollsRouter.get('/polls/history', (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit ?? '50', 10) || 50, 200);
  const offset = Number.parseInt(req.query.offset ?? '0', 10) || 0;
  const history = polls.getPollHistory({ limit, offset });
  res.json({
    // Flattened, and the poll is not repeated inside its own results -- this
    // list is the biggest payload the app fetches on a weak connection.
    polls: history.map((poll) => {
      const { total_votes, votes_by_channel, results } = polls.getResults(poll.id);
      return { ...poll, total_votes, votes_by_channel, results };
    }),
  });
});

pollsRouter.get('/polls/:id', (req, res, next) => {
  try {
    const adapter = getChannel(req.get('x-channel') ?? 'web');
    const poll = polls.getPoll(req.params.id);
    if (!poll) return next(notFound(`No poll with id "${req.params.id}".`));
    return res.json({ poll: adapter.renderPoll(poll) });
  } catch (error) {
    return next(error);
  }
});

pollsRouter.get('/polls/:id/results', (req, res, next) => {
  try {
    const adapter = getChannel(req.get('x-channel') ?? 'web');
    res.json(adapter.renderResults(polls.getResults(req.params.id)));
  } catch (error) {
    next(error);
  }
});

// Has this voter already voted? Lets a client render results straight away.
pollsRouter.get('/polls/:id/my-vote', (req, res, next) => {
  try {
    const vote = polls.findExistingVote({
      pollId: req.params.id,
      channel: req.get('x-channel') ?? 'web',
      context: { headers: req.headers, ip: req.clientIp, voterId: req.query.voter_id },
    });
    res.json({ vote: vote ?? null });
  } catch (error) {
    next(error);
  }
});

// The one write path every channel shares.
pollsRouter.post('/polls/:id/vote', (req, res, next) => {
  try {
    const channel = channelOf(req);
    const adapter = getChannel(channel);
    const { vote, results } = polls.castVote({
      pollId: req.params.id,
      channel,
      context: contextOf(req),
    });

    broadcastResults(results);
    res.status(201).json({ vote, ...adapter.renderResults(results) });
  } catch (error) {
    next(error);
  }
});
