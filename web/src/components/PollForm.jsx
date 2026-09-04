import { useState } from 'react';
import { Button, Field, inputClass } from './ui.jsx';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

const blankOptions = () => ['', ''];

/** `closes_at` is an ISO string; the input wants local `YYYY-MM-DDTHH:mm`. */
function toLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Create or edit a poll. Mirrors the server's rules (2–8 unique options) so the
 * admin gets an answer before a round trip, but the server stays the authority.
 */
export function PollForm({ poll, onSubmit, onCancel, busy }) {
  const editing = Boolean(poll);
  const lockOptions = editing && (poll.total_votes ?? 0) > 0;

  const [question, setQuestion] = useState(poll?.question ?? '');
  const [matchName, setMatchName] = useState(poll?.match_name ?? '');
  const [options, setOptions] = useState(
    poll?.options?.length ? poll.options.map((option) => option.label) : blankOptions(),
  );
  const [closesAt, setClosesAt] = useState(toLocalInput(poll?.closes_at));
  const [asDraft, setAsDraft] = useState(poll ? poll.status === 'draft' : false);
  const [problem, setProblem] = useState(null);

  const setOption = (index, value) =>
    setOptions((current) => current.map((option, at) => (at === index ? value : option)));

  const addOption = () =>
    setOptions((current) => (current.length < MAX_OPTIONS ? [...current, ''] : current));

  const removeOption = (index) =>
    setOptions((current) =>
      current.length > MIN_OPTIONS ? current.filter((_, at) => at !== index) : current,
    );

  function handleSubmit(event) {
    event.preventDefault();
    const labels = options.map((option) => option.trim()).filter(Boolean);

    if (!question.trim()) return setProblem('Give the poll a question.');
    if (labels.length < MIN_OPTIONS) return setProblem(`Add at least ${MIN_OPTIONS} options.`);
    if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
      return setProblem('Options must be different from each other.');
    }

    setProblem(null);
    return onSubmit({
      question: question.trim(),
      match_name: matchName.trim(),
      status: asDraft ? 'draft' : 'live',
      closes_at: closesAt ? new Date(closesAt).toISOString() : null,
      // Omitted entirely once votes exist — the server rejects the change.
      ...(lockOptions ? {} : { options: labels }),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Question">
        <input
          className={inputClass}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Who wins the toss?"
          maxLength={280}
          autoFocus={!editing}
        />
      </Field>

      <Field label="Match" hint="Shown above the question. Optional.">
        <input
          className={inputClass}
          value={matchName}
          onChange={(event) => setMatchName(event.target.value)}
          placeholder="India vs Australia · 2nd ODI"
          maxLength={120}
        />
      </Field>

      <div>
        <span className="mb-1.5 block text-xs font-black tracking-widest text-chalk-dim uppercase">
          Options
        </span>
        {lockOptions ? (
          <p className="mb-2 rounded-lg border-2 border-strike-500/40 bg-strike-500/10 px-3 py-2 text-xs font-bold text-chalk">
            This poll has votes, so the options are locked. Close it and create a new
            one to change them.
          </p>
        ) : null}

        <ul className="space-y-2">
          {options.map((option, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={index} className="flex gap-2">
              <input
                className={inputClass}
                value={option}
                disabled={lockOptions}
                onChange={(event) => setOption(index, event.target.value)}
                placeholder={`Option ${index + 1}`}
                maxLength={80}
              />
              {options.length > MIN_OPTIONS && !lockOptions ? (
                <button
                  type="button"
                  onClick={() => removeOption(index)}
                  aria-label={`Remove option ${index + 1}`}
                  className="min-h-14 w-14 shrink-0 rounded-lg border-2 border-pitch-600 text-xl font-black text-chalk-dim active:bg-pitch-800"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>

        {options.length < MAX_OPTIONS && !lockOptions ? (
          <button
            type="button"
            onClick={addOption}
            className="mt-2 py-2 text-xs font-black tracking-widest text-strike-500 uppercase"
          >
            + Add option
          </button>
        ) : null}
      </div>

      <Field label="Auto-close" hint="Optional. The poll closes itself at this time.">
        <input
          type="datetime-local"
          className={inputClass}
          value={closesAt}
          onChange={(event) => setClosesAt(event.target.value)}
        />
      </Field>

      <label className="flex min-h-14 items-center gap-3 rounded-lg border-2 border-pitch-600 bg-pitch-800 px-4">
        <input
          type="checkbox"
          checked={asDraft}
          onChange={(event) => setAsDraft(event.target.checked)}
          className="h-6 w-6 accent-strike-500"
        />
        <span className="text-sm font-bold text-chalk">
          Save as draft (hidden until you publish it)
        </span>
      </label>

      {problem ? (
        <p role="alert" className="text-sm font-bold text-out-500">
          {problem}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="flex-1">
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create poll'}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
