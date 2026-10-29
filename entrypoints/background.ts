import { browser, type Browser } from 'wxt/browser';
import { injectIntoTab, syncContentScripts } from '@/lib/content-scripts';
import {
  isPlannedUrlWithSession,
  planProgressiveDownload,
  type ProgressiveDownload,
} from '@/lib/download/progressive';
import {
  readExtensionPageMessage,
  readFrameMessage,
  type DownloadMessage,
  type DownloadResult,
  type DownloadUrlReply,
  type DownloadUrlRequest,
  type FrameMessage,
} from '@/lib/extension-messages';
import {
  applyPageMessage,
  badgeText,
  frameKey,
  framesOfTab,
  isTabKey,
  type FrameState,
} from '@/lib/tab-state';

// The tab the popup asked host access for; it gets the scripts once access is granted.
const ACCESS_TAB_KEY = 'access-tab';

// Frames of a tab report concurrently and each update reads before it writes, so storage
// updates run one at a time.
let queue = Promise.resolve();
function serially(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function readFrame(tabId: number, frameId: number): Promise<FrameState | undefined> {
  const key = frameKey(tabId, frameId);
  return (await browser.storage.session.get(key))[key] as FrameState | undefined;
}

async function clearTab(tabId: number): Promise<void> {
  const keys = Object.keys(await browser.storage.session.get(null));
  const ofTab = keys.filter((key) => isTabKey(key, tabId));
  if (ofTab.length) await browser.storage.session.remove(ofTab);
}

async function updateBadge(tabId: number): Promise<void> {
  const frames = framesOfTab(await browser.storage.session.get(null), tabId);
  // The tab may be gone by now.
  await browser.action.setBadgeText({ tabId, text: badgeText(frames) }).catch(() => undefined);
}

async function onFrameMessage(tabId: number, frameId: number, message: FrameMessage) {
  if (message.type === 'frame-reset') {
    // A top document that starts or goes away takes all the frames of the old page with it.
    if (frameId === 0) await clearTab(tabId);
    else await browser.storage.session.remove(frameKey(tabId, frameId));
  } else {
    const state = applyPageMessage(await readFrame(tabId, frameId), message.message);
    await browser.storage.session.set({ [frameKey(tabId, frameId)]: state });
  }
  await updateBadge(tabId);
}

async function onAccessGranted(): Promise<void> {
  await syncContentScripts();
  const { [ACCESS_TAB_KEY]: tabId } = await browser.storage.session.get(ACCESS_TAB_KEY);
  if (typeof tabId !== 'number') return;
  await browser.storage.session.remove(ACCESS_TAB_KEY);
  // Fails on pages no extension can script (chrome://, the Web Store); nothing to do there.
  await injectIntoTab(tabId).catch(() => undefined);
}

const fail = (error: string): DownloadResult => ({ ok: false, error });

// The URL that comes back from the page carries the ks. It stays in this function: it is
// never logged, stored or put in an error message.
async function download(request: DownloadMessage): Promise<DownloadResult> {
  const { tabId, frameId, entryId, flavorId } = request;
  const video = (await readFrame(tabId, frameId))?.videos.find((v) => v.entryId === entryId);
  if (!video) return fail('This video is no longer on the page. Reload the page and try again.');

  let plan: ProgressiveDownload;
  try {
    plan = planProgressiveDownload(video, flavorId);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'This video cannot be downloaded.');
  }

  const ask: DownloadUrlRequest = { type: 'download-url', entryId, flavorId };
  let url: unknown;
  try {
    const reply = (await browser.tabs.sendMessage(tabId, ask, { frameId })) as
      DownloadUrlReply | undefined;
    url = reply?.url;
  } catch {
    return fail('The page did not answer. Reload it and try again.');
  }
  if (typeof url !== 'string' || !isPlannedUrlWithSession(url, plan.url)) {
    return fail('Kalgrab could not get a download link for this video.');
  }

  try {
    await browser.downloads.download({
      url,
      filename: plan.filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
  } catch {
    return fail('Chrome could not start the download.');
  }
  return { ok: true };
}

// Download URLs carry the ks, so finished downloads of this extension leave the history as
// soon as Chrome is done with them. The file itself stays.
async function eraseFinishedDownloads(query: Browser.downloads.DownloadQuery): Promise<void> {
  const items = await browser.downloads.search(query);
  for (const item of items) {
    if (item.byExtensionId === browser.runtime.id && item.state !== 'in_progress') {
      await browser.downloads.erase({ id: item.id });
    }
  }
}

function onBrowserStart(): void {
  void syncContentScripts();
  // Catches downloads that finished or broke while the browser was closed.
  void eraseFinishedDownloads({});
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(onBrowserStart);
  browser.runtime.onStartup.addListener(onBrowserStart);
  browser.permissions.onAdded.addListener(() => void onAccessGranted());
  browser.permissions.onRemoved.addListener(() => void syncContentScripts());
  browser.tabs.onRemoved.addListener((tabId) => void serially(() => clearTab(tabId)));

  browser.downloads.onChanged.addListener((delta) => {
    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') {
      void eraseFinishedDownloads({ id: delta.id });
    }
  });

  browser.runtime.onMessage.addListener((value, sender, sendResponse) => {
    const frame = readFrameMessage(value, sender, browser.runtime.id);
    if (frame) {
      void serially(() => onFrameMessage(frame.tabId, frame.frameId, frame.message));
      return;
    }
    const request = readExtensionPageMessage(value, sender, browser.runtime.id);
    if (request?.type === 'access-requested') {
      void browser.storage.session.set({ [ACCESS_TAB_KEY]: request.tabId });
    } else if (request?.type === 'download') {
      download(request).then(sendResponse, () => sendResponse(fail('The download failed.')));
      return true;
    }
  });
});
