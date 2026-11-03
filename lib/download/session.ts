import type { PlayerSession } from '../kaltura/player-v7';
import type { SessionsMessage } from '../messages';

/**
 * The session of the player that shows the entry, or the frame's only player when the API
 * redirected the entry. Throws with a message fit for the popup.
 */
export function sessionFor(frame: SessionsMessage, entryId: string): PlayerSession {
  const session =
    frame.sessions.find((s) => s.entryId === entryId) ??
    (frame.sessions.length === 1 ? frame.sessions[0] : undefined);
  if (!session) {
    throw new Error('The player no longer shows this video. Reopen Kalgrab and try again.');
  }
  return session;
}
