// downloads.download resolves as soon as the download exists, before the user answers the
// Save As dialog. This waits for that answer, so a cancel is not reported as a download.

interface Change<T> {
  current?: T;
}

interface DownloadDelta {
  id: number;
  filename?: Change<string>;
  state?: Change<string>;
  error?: Change<string>;
}

interface DownloadItem {
  filename: string;
  state: string;
  error?: string;
}

interface Listeners<T> {
  addListener(callback: (value: T) => void): void;
  removeListener(callback: (value: T) => void): void;
}

/** The part of the downloads API this needs. */
export interface SaveAsEvents {
  onChanged: Listeners<DownloadDelta>;
  onErased: Listeners<number>;
  search(query: { id: number }): Promise<DownloadItem[]>;
}

export type SaveAsResult = 'saved' | 'cancelled' | 'failed';

function resultOf(item: { filename?: string; state?: string; error?: string }) {
  if (item.error === 'USER_CANCELED') return 'cancelled';
  if (item.state === 'interrupted') return 'failed';
  // The filename is empty until the user picks where to save.
  if (item.filename || item.state === 'complete') return 'saved';
  return null;
}

export function waitForSaveAs(downloads: SaveAsEvents, id: number): Promise<SaveAsResult> {
  return new Promise((resolve) => {
    const finish = (result: SaveAsResult) => {
      downloads.onChanged.removeListener(changed);
      downloads.onErased.removeListener(erased);
      resolve(result);
    };
    const changed = (delta: DownloadDelta) => {
      if (delta.id !== id) return;
      const result = resultOf({
        filename: delta.filename?.current,
        state: delta.state?.current,
        error: delta.error?.current,
      });
      if (result) finish(result);
    };
    const erased = (erasedId: number) => {
      if (erasedId === id) finish('cancelled');
    };
    downloads.onChanged.addListener(changed);
    downloads.onErased.addListener(erased);

    // The user may have answered before the listeners were added.
    downloads.search({ id }).then(
      ([item]) => {
        const result = item ? resultOf(item) : 'cancelled';
        if (result) finish(result);
      },
      () => {},
    );
  });
}
