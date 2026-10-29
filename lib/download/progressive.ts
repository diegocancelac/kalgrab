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
