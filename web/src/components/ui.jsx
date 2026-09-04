/** Small shared pieces so every screen reads as the same scoreboard. */

/** Status pill: LIVE / CLOSED / DRAFT. */
export function StatusPill({ status, className = '' }) {
  const styles = {
    live: 'bg-strike-500 text-pitch-950',
    closed: 'bg-pitch-700 text-chalk-dim',
    draft: 'border-2 border-pitch-600 text-chalk-dim',
  };
  return (
    <span
      className={`rounded px-2 py-0.5 text-[11px] font-black tracking-widest uppercase ${
        styles[status] ?? styles.draft
      } ${className}`}
    >
      {status === 'live' ? '● Live' : status}
    </span>
  );
}

/** Match name — the small line above every question. */
export const MatchLine = ({ children }) =>
  children ? (
    <p className="truncate text-xs font-bold tracking-widest text-chalk-dim uppercase">
      {children}
    </p>
  ) : null;

/** Big vote total, right-aligned like a scoreboard figure. */
export function VoteCount({ total, label = 'votes' }) {
  return (
    <div className="text-right leading-none">
      <div className="text-2xl font-black">{total}</div>
      <div className="text-[10px] font-bold tracking-widest text-chalk-dim uppercase">{label}</div>
    </div>
  );
}

export const Card = ({ children, className = '' }) => (
  <section
    className={`rounded-xl border-2 border-pitch-700 bg-pitch-900 p-4 animate-rise ${className}`}
  >
    {children}
  </section>
);

/** Primary action. Minimum 56px tall — thumb-sized, one-handed, standing up. */
export function Button({ variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-strike-500 text-pitch-950 active:bg-strike-600 disabled:bg-pitch-700 disabled:text-chalk-dim',
    ghost: 'border-2 border-pitch-600 text-chalk active:bg-pitch-800',
    danger: 'border-2 border-out-500 text-out-500 active:bg-out-500/10',
  };
  return (
    <button
      {...props}
      className={`min-h-14 rounded-lg px-5 text-base font-black tracking-wide uppercase transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    />
  );
}

export const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-black tracking-widest text-chalk-dim uppercase">
      {label}
    </span>
    {children}
    {hint ? <span className="mt-1 block text-xs text-chalk-dim">{hint}</span> : null}
  </label>
);

export const inputClass =
  'w-full min-h-14 rounded-lg border-2 border-pitch-600 bg-pitch-800 px-4 text-base text-chalk placeholder:text-chalk-dim/60 focus:border-strike-500 focus:outline-none';

/** Error banner. Distinguishes "you're offline" from "the server said no". */
export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  const offline = error.status === 0;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border-2 border-out-500/50 bg-out-500/10 px-4 py-3"
    >
      <p className="text-sm font-bold text-chalk">
        {offline ? "Can't reach the scoreboard." : error.message}
      </p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="shrink-0 text-xs font-black tracking-widest text-strike-500 uppercase underline"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Shown while a background refresh is failing but old data is still on screen. */
export const StaleNote = ({ stale }) =>
  stale ? (
    <p className="text-center text-xs font-bold tracking-widest text-strike-500 uppercase">
      Weak signal — showing last known scores
    </p>
  ) : null;

export const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse rounded-lg bg-pitch-800 ${className}`} />
);

export const EmptyState = ({ icon = '🏏', title, children }) => (
  <div className="py-16 text-center">
    <div className="mb-3 text-5xl">{icon}</div>
    <h2 className="text-xl font-black uppercase">{title}</h2>
    {children ? <p className="mx-auto mt-2 max-w-xs text-sm text-chalk-dim">{children}</p> : null}
  </div>
);
