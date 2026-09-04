import { Link } from 'react-router-dom';
import * as api from '../lib/api.js';
import { useLive } from '../lib/useLive.js';
import { Ballot } from '../components/Ballot.jsx';
import { Card, EmptyState, ErrorNote, MatchLine, Skeleton, StaleNote, StatusPill } from '../components/ui.jsx';

/**
 * Live polls, votable in place — no navigation needed to answer one. Each card
 * also links to its own page for a bigger board.
 */
export default function Home() {
  const { data: polls, error, stale, loading, refresh } = useLive({
    topic: '*',
    fetcher: api.getLivePolls,
  });

  if (loading && !polls) {
    return (
      <div className="space-y-4">
        {[0, 1].map((key) => (
          <Skeleton key={key} className="h-56" />
        ))}
      </div>
    );
  }

  if (error && !polls) {
    return (
      <div className="space-y-4">
        <ErrorNote error={error} onRetry={() => refresh()} />
        <EmptyState icon="📡" title="No signal">
          The scoreboard is out of reach. It will reconnect on its own.
        </EmptyState>
      </div>
    );
  }

  if (!polls?.length) {
    return (
      <EmptyState title="No polls open">
        Nothing to vote on right now. Check back at the next over.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <StaleNote stale={stale} />
      {polls.map((poll) => (
        <Card key={poll.id}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <MatchLine>{poll.match_name}</MatchLine>
              <h2 className="mt-1 text-xl font-black leading-tight tracking-tight">
                {poll.question}
              </h2>
            </div>
            <StatusPill status={poll.status} className="mt-0.5 shrink-0" />
          </div>

          <Ballot poll={poll} />

          <Link
            to={`/poll/${poll.id}`}
            className="mt-3 block py-2 text-center text-xs font-black tracking-widest text-chalk-dim uppercase active:text-strike-500"
          >
            Open full board →
          </Link>
        </Card>
      ))}
    </div>
  );
}
