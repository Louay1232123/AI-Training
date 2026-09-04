/**
 * Vote buttons. One tap, no confirm step — a poll on a phone in a crowd has to
 * be answerable in the gap between balls.
 */
export function VoteOptions({ options, onVote, pending, disabled }) {
  return (
    <ul className="space-y-2.5">
      {options.map((option) => {
        const isPending = pending === option.id;
        return (
          <li key={option.id}>
            <button
              onClick={() => onVote(option.id)}
              disabled={disabled || Boolean(pending)}
              aria-busy={isPending}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border-2 border-pitch-600 bg-pitch-800 px-4 text-left transition-colors active:border-strike-500 active:bg-pitch-700 disabled:opacity-60"
            >
              <span className="text-lg font-black tracking-tight text-chalk">{option.label}</span>
              <span
                className={`shrink-0 text-xs font-black tracking-widest uppercase ${
                  isPending ? 'text-strike-500' : 'text-chalk-dim'
                }`}
              >
                {isPending ? 'Sending…' : 'Vote'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
