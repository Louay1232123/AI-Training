import { badRequest } from '../lib/errors.js';

/**
 * A channel adapter is the ONLY place a delivery surface (web page, WhatsApp
 * bot, Telegram bot, mobile app) is allowed to differ. Everything downstream
 * -- services, repositories, SQL -- is channel-agnostic.
 *
 * An adapter answers two questions:
 *   1. identity  -- who is voting, given this channel's own notion of a user?
 *   2. rendering -- how should a poll or a result set look on this surface?
 *
 * To add a channel: subclass this, implement `resolveVoter`, override the
 * renderers if the surface is not JSON, and register it in `channels/index.js`.
 * No route, service or query needs to change.
 */
export class ChannelAdapter {
  /** @param {{ name: string, supportsRichResults?: boolean }} options */
  constructor({ name, supportsRichResults = true }) {
    this.name = name;
    this.supportsRichResults = supportsRichResults;
  }

  /**
   * Turns a channel-native context into a stable, opaque voter id.
   *
   * The id only has to be stable per person per channel: a browser device id,
   * a WhatsApp phone number, a Telegram user id, a mobile install id. Votes are
   * keyed on (poll_id, channel, voter_id), so ids never collide across channels.
   *
   * @param {object} context channel-native request context
   * @returns {{ voterId: string, ip?: string|null }}
   */
  // eslint-disable-next-line no-unused-vars
  resolveVoter(context) {
    throw new Error(`${this.name} adapter must implement resolveVoter()`);
  }

  /** Rejects an empty/oversized voter id before it reaches the database. */
  assertVoterId(voterId) {
    const value = typeof voterId === 'string' ? voterId.trim() : '';
    if (!value) {
      throw badRequest(`A voter_id is required for the "${this.name}" channel.`);
    }
    if (value.length > 200) {
      throw badRequest('voter_id must be 200 characters or fewer.');
    }
    return value;
  }

  /**
   * Resolves the option the voter picked. Structured channels send an option
   * id; chat channels let people reply "2" or type the option text, so those
   * adapters override this.
   *
   * @returns {{ optionId?: string, optionRef?: string }}
   */
  resolveOption({ optionId, optionRef }) {
    return { optionId, optionRef };
  }

  /** Outbound shape for a poll. JSON by default. */
  renderPoll(poll) {
    return poll;
  }

  /** Outbound shape for a result set. JSON by default. */
  renderResults(results) {
    return results;
  }
}
