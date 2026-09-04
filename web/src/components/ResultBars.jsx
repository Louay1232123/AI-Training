/**
 * The scoreboard bar chart. Percentages come from the server so every channel
 * shows identical numbers; this component only draws them.
 *
 * Reads at arm's length: the bar itself is the tap-target-sized row, the label
 * and the number sit on top of it, and the leader is the only bright bar.
 */
export function ResultBars({ results, myOptionId, total, closed = false }) {
  return (
    <ul className="space-y-2.5">
      {results.map((row) => {
        const isMine = row.option_id === myOptionId;
        const leading = row.leading && total > 0;

        return (
          <li key={row.option_id}>
            <div className="relative h-14 overflow-hidden rounded-lg border-2 border-pitch-700 bg-pitch-800">
              {/* The bar. Width is the only thing that animates, so a tick-up
                  stays cheap on a mid-range phone. */}
              <div
                className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out ${
                  leading
                    ? closed
                      ? 'bg-crowd-600/70'
                      : 'bg-strike-500/80'
                    : isMine
                      ? 'bg-crowd-600/45'
                      : 'bg-pitch-500'
                }`}
                // A row with no votes gets no bar; anything above zero keeps a
                // 2% minimum so a 0.4% option is still visibly on the board.
                style={{ width: `${row.votes === 0 ? 0 : Math.max(row.percentage, 2)}%` }}
              />

              <div className="relative flex h-full items-center justify-between gap-3 px-3.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-base font-black tracking-tight text-chalk">
                    {row.label}
                  </span>
                  {isMine ? (
                    <span className="shrink-0 rounded bg-crowd-500 px-1.5 py-0.5 text-[10px] font-black tracking-widest text-pitch-950 uppercase">
                      You
                    </span>
                  ) : null}
                </span>

                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-xl font-black text-chalk">{row.percentage}%</span>
                  <span className="w-8 text-right text-xs font-bold text-chalk-dim">
                    {row.votes}
                  </span>
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
