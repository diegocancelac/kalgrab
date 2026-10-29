import { toFilename } from '../filename';
import { flavorUrl, type VideoInfo } from '../kaltura/playback-context';

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

function sameParams(a: URLSearchParams, b: URLSearchParams): boolean {
  const sorted = (params: URLSearchParams) => JSON.stringify([...params].sort());
  return sorted(a) === sorted(b);
}

/**
 * The MAIN-world script answers a download with the planned URL plus the session (a
 * "/ks/<value>" path pair, see withKs) and the page's "referrer" parameter, as the player
 * sends them. The page can answer in its place, so any other difference rejects the URL:
 * a download only ever goes to the flavor that was planned.
 */
export function isPlannedUrlWithSession(received: string, planned: string): boolean {
  let url: URL;
  let plan: URL;
  try {
    url = new URL(received);
    plan = new URL(planned);
  } catch {
    return false;
  }
  if (url.origin !== plan.origin || url.username || url.password || url.hash) return false;

  const parts = url.pathname.split('/');
  const manifest = parts.indexOf('playManifest');
  const ks = manifest < 0 ? -1 : parts.indexOf('ks', manifest + 1);
  if (ks < 0 || !parts[ks + 1]) return false;
  parts.splice(ks, 2);
  if (parts.join('/') !== plan.pathname) return false;

  const params = new URLSearchParams(url.search);
  params.delete('referrer');
  return sameParams(params, plan.searchParams);
}
