import { describe, expect, it } from 'vitest';
import { eraseFinishedDownloads, type DownloadHistory } from '../lib/download/history';

const ID = 'kalgrabextensionid';

interface Item {
  id: number;
  state: 'in_progress' | 'complete' | 'interrupted';
  byExtensionId?: string;
}

// An in-memory downloads history that filters like downloads.search.
function fakeDownloads(items: Item[]) {
  let history = [...items];
  const downloads: DownloadHistory = {
    search: async ({ id, state }) =>
      history.filter((i) => (id === undefined || i.id === id) && (!state || i.state === state)),
    erase: async ({ id }) => {
      history = history.filter((i) => i.id !== id);
      return [id];
    },
  };
  return { downloads, remaining: () => history.map((i) => i.id) };
}

describe('eraseFinishedDownloads', () => {
  const items: Item[] = [
    { id: 1, state: 'complete', byExtensionId: ID },
    { id: 2, state: 'interrupted', byExtensionId: ID },
    { id: 3, state: 'in_progress', byExtensionId: ID },
    { id: 4, state: 'complete' },
    { id: 5, state: 'complete', byExtensionId: 'another-extension' },
    { id: 6, state: 'interrupted' },
  ];

  it('sweeps every complete or interrupted download of the extension', async () => {
    const { downloads, remaining } = fakeDownloads(items);
    await eraseFinishedDownloads(downloads, ID);
    expect(remaining()).toEqual([3, 4, 5, 6]);
  });

  it('erases only the given download when an id is passed', async () => {
    const { downloads, remaining } = fakeDownloads(items);
    await eraseFinishedDownloads(downloads, ID, 2);
    expect(remaining()).toEqual([1, 3, 4, 5, 6]);
  });

  it('leaves a download that is still running, or one that is not ours', async () => {
    for (const id of [3, 4, 5, 6]) {
      const { downloads, remaining } = fakeDownloads(items);
      await eraseFinishedDownloads(downloads, ID, id);
      expect(remaining(), String(id)).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('does nothing for a download that is no longer in the history', async () => {
    const { downloads, remaining } = fakeDownloads(items);
    await eraseFinishedDownloads(downloads, ID, 99);
    expect(remaining()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
