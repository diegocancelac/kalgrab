import { describe, expect, it } from 'vitest';
import { waitForSaveAs, type SaveAsEvents } from '../lib/download/save-as';

type Item = { id: number; filename: string; state: string; error?: string };
type Delta = Parameters<Parameters<SaveAsEvents['onChanged']['addListener']>[0]>[0];

function emitter<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    listeners,
    addListener: (callback: (value: T) => void) => void listeners.add(callback),
    removeListener: (callback: (value: T) => void) => void listeners.delete(callback),
    emit: (value: T) => [...listeners].forEach((callback) => callback(value)),
  };
}

function fakeDownloads(items: Item[]) {
  const onChanged = emitter<Delta>();
  const onErased = emitter<number>();
  const downloads: SaveAsEvents = {
    onChanged,
    onErased,
    search: async ({ id }) => items.filter((item) => item.id === id),
  };
  const listening = () => onChanged.listeners.size + onErased.listeners.size;
  return { downloads, onChanged, onErased, listening };
}

const pending: Item = { id: 7, filename: '', state: 'in_progress' };

describe('waitForSaveAs', () => {
  it('reports saved once the user picks a file, and stops listening', async () => {
    const fake = fakeDownloads([pending]);
    const result = waitForSaveAs(fake.downloads, 7);
    await Promise.resolve();
    fake.onChanged.emit({ id: 8, filename: { current: '/tmp/other.mp4' } });
    fake.onChanged.emit({ id: 7, filename: { current: '/tmp/Lecture.mp4' } });
    expect(await result).toBe('saved');
    expect(fake.listening()).toBe(0);
  });

  it('reports a cancelled dialog', async () => {
    const fake = fakeDownloads([pending]);
    const result = waitForSaveAs(fake.downloads, 7);
    await Promise.resolve();
    fake.onChanged.emit({
      id: 7,
      state: { current: 'interrupted' },
      error: { current: 'USER_CANCELED' },
    });
    expect(await result).toBe('cancelled');
  });

  it('reports a download erased before an answer as cancelled', async () => {
    const fake = fakeDownloads([pending]);
    const result = waitForSaveAs(fake.downloads, 7);
    await Promise.resolve();
    fake.onErased.emit(7);
    expect(await result).toBe('cancelled');
  });

  it('reports other interruptions as failed', async () => {
    const fake = fakeDownloads([pending]);
    const result = waitForSaveAs(fake.downloads, 7);
    await Promise.resolve();
    fake.onChanged.emit({
      id: 7,
      state: { current: 'interrupted' },
      error: { current: 'NETWORK_FAILED' },
    });
    expect(await result).toBe('failed');
  });

  it('reads the answer given before it started listening', async () => {
    const cases: [Item[], string][] = [
      [[{ ...pending, filename: '/tmp/Lecture.mp4' }], 'saved'],
      [[{ ...pending, filename: '/tmp/Lecture.srt', state: 'complete' }], 'saved'],
      [[{ ...pending, state: 'interrupted', error: 'USER_CANCELED' }], 'cancelled'],
      [[], 'cancelled'],
    ];
    for (const [items, expected] of cases) {
      const fake = fakeDownloads(items);
      expect(await waitForSaveAs(fake.downloads, 7)).toBe(expected);
      expect(fake.listening()).toBe(0);
    }
  });
});
