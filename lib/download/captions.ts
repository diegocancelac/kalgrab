import { vttToSrt } from '../captions';
import { toCaptionFilename } from '../filename';
import { withKs, type VideoInfo } from '../kaltura/playback-context';
import type { SessionsMessage } from '../messages';
import { sessionFor } from './session';

const TIMEOUT_MS = 15_000;

export interface CaptionDownload {
  filename: string;
  /** The track's WebVTT URL, still without a ks. */
  url: string;
}

/** Throws with a message fit for the popup when the track cannot be downloaded. */
export function planCaptionDownload(video: VideoInfo, index: number): CaptionDownload {
  if (video.isProtected) throw new Error('This video is protected.');
  if (video.blocked) throw new Error(video.blocked.reason);
  const caption = video.captions[index];
  if (!caption) throw new Error('These captions are no longer listed. Reopen Kalgrab.');
  return {
    filename: toCaptionFilename(video.title, caption.languageCode ?? caption.label),
    url: caption.url,
  };
}

/** The track URL with the session of the player that shows the video. Carries the ks. */
export function signedCaptionUrl(
  plan: CaptionDownload,
  entryId: string,
  frame: SessionsMessage,
): string {
  const session = sessionFor(frame, entryId);
  return withKs(plan.url, session.ks, session.allowedOrigins);
}

/**
 * Fetches the track and converts it to SRT. The URL carries the ks: the errors only name its
 * host.
 */
export async function fetchSrt(
  url: string,
  fetchApi: typeof fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<string> {
  const { host } = new URL(url);
  const unreachable = () => new Error(`Could not reach ${host}.`);
  let response: Response;
  try {
    response = await fetchApi(url, { credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw unreachable();
  }
  if (!response.ok) throw new Error(`${host} did not return the captions.`);
  let vtt: string;
  try {
    vtt = await response.text();
  } catch {
    throw unreachable();
  }
  const srt = vttToSrt(vtt);
  if (!srt) throw new Error('These captions have no text.');
  return srt;
}

/**
 * A service worker has no URL.createObjectURL, so the file is saved from a data URL. The BOM
 * makes Windows players read accented text as UTF-8.
 */
export function srtDataUrl(srt: string): string {
  const bytes = new TextEncoder().encode(String.fromCharCode(0xfeff) + srt);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:application/x-subrip;base64,${btoa(binary)}`;
}
