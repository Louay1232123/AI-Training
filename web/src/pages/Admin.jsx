import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api.js';
import { clearAdminPassword, readAdminPassword, storeAdminPassword } from '../lib/adminAuth.js';
import { PollForm } from '../components/PollForm.jsx';
import { ResultBars } from '../components/ResultBars.jsx';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  MatchLine,
  Skeleton,
  StatusPill,
  VoteCount,
  inputClass,
} from '../components/ui.jsx';

/** Single-admin console: create, publish, edit, close and delete polls. */
export default function Admin() {
  const [password, setPassword] = useState(() => readAdminPassword());

  if (!password) {
    return (
      <PasswordGate
        onUnlock={(value) => {
          storeAdminPassword(value);
          setPassword(value);
        }}
      />
    );
  }

  return (
    <Console
      password={password}
      onLock={() => {
        clearAdminPassword();
        setPassword(null);
      }}
    />
  );
}

/* -------------------------------------------------------------------- gate */

function PasswordGate({ onUnlock }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Verified before it is stored, so a typo fails here and not on every
      // later request.
      await api.verifyAdmin(value);
      onUnlock(value);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-8">
      <h1 className="text-2xl font-black uppercase">Admin</h1>
      <p className="mt-1 mb-5 text-sm text-chalk-dim">
        Enter the admin password to run polls.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Password">
          <input
            type="password"
            className={inputClass}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" disabled={busy || !value} className="w-full">
          {busy ? 'Checking…' : 'Unlock'}
        </Button>
      </form>
    </Card>
  );
}

/* ----------------------------------------------------------------- console */

function Console({ password, onLock }) {
  const [polls, setPolls] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setPolls(await api.adminListPolls(password));
      setError(null);
    } catch (nextError) {
      // A rejected password means the stored one is stale — back to the gate.
      if (nextError.status === 401) return onLock();
      setError(nextError);
    }
    return undefined;
  }, [password, onLock]);

  useEffect(() => {
    load();
    // Slow refresh: the admin needs vote counts to move, not a live feed.
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  /** Wraps an admin action with a busy flag, error capture and a reload. */
  const run = async (id, action) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (nextError) {
      setError(nextError);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const createPoll = async (input) => {
    const ok = await run('new', () => api.adminCreatePoll(password, input));
    if (ok) setCreating(false);
  };

  const savePoll = async (id, input) => {
    const ok = await run(id, () => api.adminUpdatePoll(password, id, input));
    if (ok) setEditingId(null);
  };

  const closePoll = (id) => run(id, () => api.adminClosePoll(password, id));
  const openPoll = (id) => run(id, () => api.adminOpenPoll(password, id));

  const deletePoll = (id, question) => {
    // Deleting takes the votes with it, so make the admin say yes out loud.
    if (!window.confirm(`Delete "${question}" and all its votes? This cannot be undone.`)) return;
    run(id, () => api.adminDeletePoll(password, id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black uppercase">Admin</h1>
        <button
          onClick={onLock}
          className="py-2 text-xs font-black tracking-widest text-chalk-dim uppercase active:text-strike-500"
        >
          Lock
        </button>
      </div>

      <ErrorNote error={error} onRetry={load} />

      {creating ? (
        <Card>
          <h2 className="mb-4 text-lg font-black uppercase">New poll</h2>
          <PollForm onSubmit={createPoll} onCancel={() => setCreating(false)} busy={busyId === 'new'} />
        </Card>
      ) : (
        <Button onClick={() => setCreating(true)} className="w-full">
          + New poll
        </Button>
      )}

      {polls === null ? (
        <Skeleton className="h-40" />
      ) : polls.length === 0 ? (
        <EmptyState title="No polls yet">Create the first one above.</EmptyState>
      ) : (
        polls.map((poll) => (
          <Card key={poll.id}>
            {editingId === poll.id ? (
              <>
                <h2 className="mb-4 text-lg font-black uppercase">Edit poll</h2>
                <PollForm
                  poll={poll}
                  onSubmit={(input) => savePoll(poll.id, input)}
                  onCancel={() => setEditingId(null)}
                  busy={busyId === poll.id}
                />
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <MatchLine>{poll.match_name}</MatchLine>
                    <h2 className="mt-1 text-lg font-black leading-tight tracking-tight">
                      {poll.question}
                    </h2>
                    <div className="mt-2">
                      <StatusPill status={poll.status} />
                    </div>
                  </div>
                  <VoteCount total={poll.total_votes ?? 0} />
                </div>

                {poll.total_votes > 0 ? (
                  <div className="mt-3">
                    <ResultBars
                      results={poll.results ?? []}
                      total={poll.total_votes}
                      closed={poll.status === 'closed'}
                    />
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {poll.status === 'live' ? (
                    <Button
                      variant="ghost"
                      disabled={busyId === poll.id}
                      onClick={() => closePoll(poll.id)}
                      className="flex-1"
                    >
                      Close
                    </Button>
                  ) : null}

                  {poll.status === 'draft' ? (
                    <Button
                      disabled={busyId === poll.id}
                      onClick={() => openPoll(poll.id)}
                      className="flex-1"
                    >
                      Publish
                    </Button>
                  ) : null}

                  {poll.status !== 'closed' ? (
                    <Button
                      variant="ghost"
                      disabled={busyId === poll.id}
                      onClick={() => setEditingId(poll.id)}
                      className="flex-1"
                    >
                      Edit
                    </Button>
                  ) : (
                    <Button
                      disabled={busyId === poll.id}
                      onClick={() => openPoll(poll.id)}
                      className="flex-1"
                    >
                      Reopen
                    </Button>
                  )}

                  <Button
                    variant="danger"
                    disabled={busyId === poll.id}
                    onClick={() => deletePoll(poll.id, poll.question)}
                  >
                    Delete
                  </Button>
                </div>

                <Link
                  to={`/poll/${poll.id}`}
                  className="mt-3 block py-2 text-center text-xs font-black tracking-widest text-chalk-dim uppercase active:text-strike-500"
                >
                  View public board →
                </Link>
              </>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
