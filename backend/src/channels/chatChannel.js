import { ChannelAdapter } from './channelAdapter.js';

/**
 * PHASE 2 STUB -- shared adapter for messaging channels (WhatsApp, Telegram).
 *
 * This is deliberately transport-free: it does the two channel-specific jobs
 * (identity + plain-text rendering) and nothing else. A bot process supplies
 * the transport only -- receive a webhook, call the poll API, send the rendered
 * text back. See /bots/README.md for the wiring.
 *
 * Nothing here is wired to a live bot yet; the adapters are registered so the
 * API already accepts and correctly attributes `channel=whatsapp|telegram`
 * votes today.
 */
export class ChatChannelAdapter extends ChannelAdapter {
  /** @param {{ name: string, idPrefix: string }} options */
  constructor({ name, idPrefix }) {
    super({ name, supportsRichResults: false });
    this.idPrefix = idPrefix;
  }

  /**
   * Chat platforms already give every sender a stable id (a phone number, a
   * Telegram user id). We namespace it so it can never be mistaken for a web
   * device id, then hand it over as an opaque string.
   */
  resolveVoter(context = {}) {
    const raw =
      context.voterId ??
      context.body?.voter_id ??
      context.from ??
      context.message?.from?.id ??
      '';
    const value = String(raw).trim();
    const voterId = value.startsWith(`${this.idPrefix}:`)
      ? value
      : `${this.idPrefix}:${value}`;
    return { voterId: this.assertVoterId(value ? voterId : ''), ip: context.ip ?? null };
  }

  /**
   * Chat replies are free text: "2", "England", "england ". Resolve a typed
   * reply against the poll's options -- by 1-based number first, then by an
   * exact case-insensitive label match.
   */
  resolveOption({ optionId, optionRef, poll } = {}) {
    if (optionId) return { optionId };
    const reply = String(optionRef ?? '').trim();
    if (!reply || !poll) return { optionRef: reply };

    const byNumber = Number.parseInt(reply, 10);
    if (String(byNumber) === reply && byNumber >= 1 && byNumber <= poll.options.length) {
      return { optionId: poll.options[byNumber - 1].id };
    }

    const match = poll.options.find(
      (option) => option.label.toLowerCase() === reply.toLowerCase(),
    );
    return match ? { optionId: match.id } : { optionRef: reply };
  }

  /** A poll as a numbered chat message people can reply to. */
  renderPoll(poll) {
    const lines = [
      poll.match_name ? `🏏 ${poll.match_name}` : '🏏 Cricket Polls',
      `*${poll.question}*`,
      '',
      ...poll.options.map((option, index) => `${index + 1}. ${option.label}`),
      '',
      'Reply with a number to vote.',
    ];
    return { text: lines.filter((line) => line !== undefined).join('\n'), poll };
  }

  /** Results as a chat message with text bars, safe on any client. */
  renderResults(results) {
    const bars = results.results.map((row) => {
      const filled = Math.round((row.percentage / 100) * 10);
      const bar = '█'.repeat(filled).padEnd(10, '░');
      return `${bar} ${row.percentage}%  ${row.label} (${row.votes})`;
    });
    const lines = [
      `*${results.poll.question}*`,
      results.poll.match_name ? results.poll.match_name : undefined,
      '',
      ...bars,
      '',
      `${results.total_votes} vote${results.total_votes === 1 ? '' : 's'}` +
        (results.poll.status === 'closed' ? ' · final' : ' · voting open'),
    ];
    return { text: lines.filter((line) => line !== undefined).join('\n'), results };
  }
}
