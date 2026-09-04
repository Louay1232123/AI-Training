import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { getLocalVote, rememberVote } from '../lib/device.js';
import { useLive } from '../lib/useLive.js';
import { ResultBars } from './ResultBars.jsx';
import { VoteOptions } from './VoteOptions.jsx';
import { ErrorNote, StaleNote, Skeleton } from './ui.jsx';

/**
 * Vote, then watch the results move. Used by both the live list and the poll
 * page, so voting behaves identically wherever it is tapped.
 *
 * Results arrive over the shared WebSocket and, as a fallback, a 3s refetch.
 */
export function Ballot({ poll, autoShowResults = false }) {
  // Cached locally so a reload shows results straight away instead of the
  // ballot flashing up before the server answers.
  const [myOptionId, setMyOptionId] = useState(() => getLocalVote(poll.id));
  const [pending, setPending] = useState(null);
  const [voteError, setVoteError] = useState(null);

  const { data, error, stale, loading, refresh, setData } = useLive({
    topic: poll.id,
    fetcher: () => api.getResults(poll.id),
    // The socket already carries the full result set, so no refetch is needed.
    fromMessage: (message) => (message.type === 'results' ? message.results : null),
  });

  // Authoritative check: catches a vote that landed but whose local record was
  // lost (storage full, private mode, closed mid-request).
  useEffect(() => {
    let cancelled = false;
    api
      .getMyVote(poll.id)
      .then((vote) => {
        if (!cancelled && vote) {
          setMyOptionId(vote.option_id);
          rememberVote(poll.id, vote.option_id);
        }
      })
      .catch(() => {
        /* offline: the local record stands in until the network returns */
      });
    return () => {
      cancelled = true;
    };
  }, [poll.id]);

  const closed = (data?.poll ?? poll).status === 'closed';
  const showResults = Boolean(myOptionId) || closed || autoShowResults;

  async function castVote(optionId) {
    setPending(optionId);
    setVoteError(null);
    try {
      const response = await api.vote(poll.id, optionId);
      rememberVote(poll.id, optionId);
      setMyOptionId(optionId);
      setData({ ...response, poll: response.poll ?? poll });
    } catch (nextError) {
      // Already voted, or the poll closed under us: both answers include the
      // current results, so show the scoreboard rather than a dead end.
      if (nextError.details?.results) {
        setData(nextError.details.results);
        const existing = nextError.details.vote?.option_id;
        if (existing) {
          setMyOptionId(existing);
          rememberVote(poll.id, existing);
        }
        if (nextError.code !== 'already_voted') setVoteError(nextError);
      } else {
        setVoteError(nextError);
      }
      refresh();
    } finally {
      setPending(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-2.5">
        {poll.options.map((option) => (
          <Skeleton key={option.id} className="h-14" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showResults ? (
        <>
          <ResultBars
            results={data?.results ?? []}
            myOptionId={myOptionId}
            total={data?.total_votes ?? 0}
            closed={closed}
          />
          <div className="flex items-center justify-between text-xs font-bold tracking-widest text-chalk-dim uppercase">
            <span>
              {data?.total_votes ?? 0} {data?.total_votes === 1 ? 'vote' : 'votes'}
            </span>
            <span>{closed ? 'Final' : myOptionId ? 'Vote counted' : 'Voting open'}</span>
          </div>
        </>
      ) : (
        <VoteOptions options={poll.options} onVote={castVote} pending={pending} />
      )}

      <StaleNote stale={stale} />
      <ErrorNote error={voteError ?? error} onRetry={() => refresh()} />
    </div>
  );
}
