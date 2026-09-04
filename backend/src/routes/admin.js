import { Router } from 'express';
import * as polls from '../services/pollService.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { broadcastPollEvent, broadcastResults } from '../realtime/hub.js';

/** Admin API. Single password, no user table -- see middleware/adminAuth.js. */
export const adminRouter = Router();

adminRouter.use(requireAdmin);

// Lets the admin UI verify a password before storing it.
adminRouter.post('/session', (_req, res) => {
  res.json({ ok: true });
});

// Every poll in any state, each with its current tally.
adminRouter.get('/polls', (req, res, next) => {
  try {
    const limit = Math.min(Number.parseInt(req.query.limit ?? '100', 10) || 100, 200);
    const offset = Number.parseInt(req.query.offset ?? '0', 10) || 0;
    const all = polls.listAllPolls({ limit, offset });
    res.json({
      polls: all.map((poll) => {
        const results = polls.getResults(poll.id);
        return { ...poll, total_votes: results.total_votes, results: results.results };
      }),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/polls', (req, res, next) => {
  try {
    const poll = polls.createPoll(req.body ?? {});
    broadcastPollEvent('poll_created', poll);
    res.status(201).json({ poll });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch('/polls/:id', (req, res, next) => {
  try {
    const poll = polls.updatePoll(req.params.id, req.body ?? {});
    broadcastPollEvent(poll.status === 'closed' ? 'poll_closed' : 'poll_updated', poll);
    broadcastResults(polls.getResults(poll.id));
    res.json({ poll });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/polls/:id/close', (req, res, next) => {
  try {
    const poll = polls.closePoll(req.params.id);
    broadcastPollEvent('poll_closed', poll);
    broadcastResults(polls.getResults(poll.id));
    res.json({ poll, ...polls.getResults(poll.id) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/polls/:id/open', (req, res, next) => {
  try {
    const poll = polls.openPoll(req.params.id);
    broadcastPollEvent('poll_created', poll);
    res.json({ poll });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete('/polls/:id', (req, res, next) => {
  try {
    polls.deletePoll(req.params.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
