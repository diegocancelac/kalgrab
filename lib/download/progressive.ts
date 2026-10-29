import { toFilename } from '../filename';
import { flavorUrl, withKs, withReferrer, type VideoInfo } from '../kaltura/playback-context';
import type { SessionsMessage } from '../messages';

export interface ProgressiveDownload {
  filename: string;
  /** The flavor's playManifest URL, still without a ks. */
  url: string;
}

/** Throws with a message fit for the popup when the flavor cannot be downloaded this way. */
export function planProgressiveDownload(video: VideoInfo, flavorId: string): ProgressiveDownload {
  if (video.isProtected) throw new Error('This video is protected.');
  if (video.blocked) throw new Error(video.blocked.reason);
  if (!video.progressive) throw new Error('This video has no MP4 download.');
  if (!video.progressive.flavorIds.includes(flavorId)) {
    throw new Error('This quality is not available as an MP4 download.');
  }
  const flavor = video.flavors.find((f) => f.id === flavorId);
  return {
    filename: toFilename(video.title, flavor?.fileExt ?? 'mp4'),
    url: flavorUrl(video.progressive, flavorId),
  };
}

/**
 * The planned URL with the page as referrer and the session of the player that shows the
 * video: the one for its entry, or the frame's only player when the API redirected the
 * entry. The result carries the ks: it goes to downloads.download and nowhere else. Throws
 * with a message fit for the popup, which never contains the URL or the ks.
 */
export function signedDownloadUrl(
  plan: ProgressiveDownload,
  entryId: string,
  frame: SessionsMessage,
): string {
  const session =
    frame.sessions.find((s) => s.entryId === entryId) ??
    (frame.sessions.length === 1 ? frame.sessions[0] : undefined);
  if (!session) {
    throw new Error('The player no longer shows this video. Reopen Kalgrab and try again.');
  }
  return withKs(withReferrer(plan.url, frame.pageUrl), session.ks, session.allowedOrigins);
}
