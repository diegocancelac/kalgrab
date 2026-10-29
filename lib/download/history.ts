/** The part of the downloads API used here, as browser.downloads provides it. */
export interface DownloadHistory {
  search(query: {
    id?: number;
    state?: 'complete' | 'interrupted';
  }): Promise<{ id: number; byExtensionId?: string }[]>;
  erase(query: { id: number }): Promise<unknown>;
}

/**
 * Download URLs carry the ks, so the extension's own downloads leave the history as soon as
 * they are complete or interrupted. The file itself stays. Without `id`, sweeps every
 * finished download of the extension.
 */
export async function eraseFinishedDownloads(
  downloads: DownloadHistory,
  extensionId: string,
  id?: number,
): Promise<void> {
  for (const state of ['complete', 'interrupted'] as const) {
    const items = await downloads.search(id === undefined ? { state } : { id, state });
    for (const item of items) {
      if (item.byExtensionId === extensionId) await downloads.erase({ id: item.id });
    }
  }
}
