import { Link, useParams } from 'react-router-dom';
import * as api from '../lib/api.js';
import { useLive } from '../lib/useLive.js';
import { Ballot } from '../components/Ballot.jsx';
import { EmptyState, ErrorNote, MatchLine, Skeleton, StatusPill } from '../components/ui.jsx';

/** One poll, full screen: vote and then watch the live board. */
export default function PollPage() {
  const { id } = useParams();
  const { data: poll, error, loading, refresh } = useLive({
    topic: id,
    fetcher: () => api.getPoll(id),
    fromMessage: (message) => message.poll ?? null,
  });

  if (loading && !poll) return <Skeleton className="h-72" />;

  if (error?.status === 404) {
    return (
      <EmptyState icon="🔍" title="Poll not found">
        <Link to="/" className="font-black text-strike-500 underline">
          Back to live polls
        </Link>
      </EmptyState>
    );
  }

  if (!poll) {
    return <ErrorNote error={error} onRetry={() => refresh()} />;
  }

  return (
    <article className="space-y-5 animate-rise">
      <header>
        <MatchLine>{poll.match_name}</MatchLine>
        <h1 className="mt-1.5 text-3xl font-black leading-tight tracking-tight">
          {poll.question}
        </h1>
        <div className="mt-3 flex items-center gap-2">
          <StatusPill status={poll.status} />
          {poll.closes_at && poll.status === 'live' ? (
            <span className="text-xs font-bold tracking-widest text-chalk-dim uppercase">
              Closes {new Date(poll.closes_at).toLocaleTimeString([], { timeStyle: 'short' })}
            </span>
          ) : null}
        </div>
      </header>

      <Ballot poll={poll} />

      <Link
        to="/"
        className="block py-3 text-center text-xs font-black tracking-widest text-chalk-dim uppercase active:text-strike-500"
      >
        ← All live polls
      </Link>
    </article>
  );
}
