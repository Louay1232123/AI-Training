import { NavLink, Link } from 'react-router-dom';
import { useRealtimeStatus } from '../lib/useLive.js';

const TABS = [
  { to: '/', label: 'Live' },
  { to: '/history', label: 'Results' },
];

/** Live/offline badge. Small, but it is the answer to "is this thing stuck?". */
function ConnectionDot() {
  const status = useRealtimeStatus();
  // No live subscriptions on this screen (the admin console polls instead), or
  // the first connection is still in flight: say nothing rather than "Retry".
  if (status === 'idle' || status === 'connecting') return null;
  const live = status === 'open';
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest uppercase"
      title={live ? 'Live updates connected' : 'Reconnecting — results still refresh every 3s'}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          live ? 'bg-crowd-500 animate-pulse' : 'bg-strike-500'
        }`}
      />
      <span className={live ? 'text-crowd-500' : 'text-strike-500'}>
        {live ? 'Live' : 'Retry'}
      </span>
    </span>
  );
}

/** App shell: sticky scoreboard header, bottom-safe content area. */
export function Chrome({ children }) {
  return (
    <div className="min-h-dvh bg-pitch-950">
      <header className="sticky top-0 z-20 border-b-2 border-pitch-700 bg-pitch-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-2xl leading-none">🏏</span>
            <span className="text-xl font-black tracking-tight uppercase">
              Cricket<span className="text-strike-500">Polls</span>
            </span>
          </Link>
          <ConnectionDot />
        </div>

        <nav className="mx-auto flex max-w-2xl gap-1 px-2">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                `flex-1 border-b-4 px-3 py-3 text-center text-sm font-black tracking-widest uppercase transition-colors ${
                  isActive
                    ? 'border-strike-500 text-chalk'
                    : 'border-transparent text-chalk-dim active:text-chalk'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  );
}
