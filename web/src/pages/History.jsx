import * as api from '../lib/api.js';
import { useLive } from '../lib/useLive.js';
import { ResultBars } from '../components/ResultBars.jsx';
import { getLocalVote } from '../lib/device.js';
import {
  Card,
  EmptyState,
  ErrorNote,
  MatchLine,
  Skeleton,
  StaleNote,
  VoteCount,
} from '../components/ui.jsx';

/* Intl rejects dateStyle/timeStyle mixed with individual fields, so spell the
   fields out: "4 Sep, 19:42". */
const shortDate = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/** Closed polls with their final results — the completed scorecard. */
export default function History() {
  const { data: polls, error, stale, loading, refresh } = useLive({
    topic: '*',
    fetcher: api.getHistory,
  });

  if (loading && !polls) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-48" />
        ))}
      </div>
    );
  }

  if (error && !polls) return <ErrorNote error={error} onRetry={() => refresh()} />;

  if (!polls?.length) {
    return (
      <EmptyState icon="📋" title="No results yet">
        Closed polls and their final scores land here.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <StaleNote stale={stale} />
      {polls.map((poll) => {
        // `leading` is set on every row sharing the top score, so a tie must
        // not be reported as a win for whichever option happens to be first.
        const leaders = poll.total_votes > 0 ? (poll.results ?? []).filter((row) => row.leading) : [];
        return (
          <Card key={poll.id}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <MatchLine>{poll.match_name}</MatchLine>
                <h2 className="mt-1 text-lg font-black leading-tight tracking-tight">
                  {poll.question}
                </h2>
                <p className="mt-1 text-[11px] font-bold tracking-widest text-chalk-dim uppercase">
                  Closed {shortDate(poll.closed_at ?? poll.updated_at)}
                </p>
              </div>
              <VoteCount total={poll.total_votes ?? 0} />
            </div>

            {poll.total_votes > 0 ? (
              <>
                <ResultBars
                  results={poll.results ?? []}
                  myOptionId={getLocalVote(poll.id)}
                  total={poll.total_votes}
                  closed
                />
                {leaders.length > 0 ? (
                  <p className="mt-3 text-xs font-black tracking-widest text-crowd-500 uppercase">
                    {leaders.length === 1
                      ? `Crowd’s pick · ${leaders[0].label}`
                      : `Tied · ${leaders.map((row) => row.label).join(' / ')}`}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="py-4 text-center text-sm text-chalk-dim">
                Closed with no votes cast.
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
