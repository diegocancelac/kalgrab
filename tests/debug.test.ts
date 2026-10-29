import { describe, expect, it, vi } from 'vitest';
import { trace, withoutUrls } from '../lib/debug';

describe('trace', () => {
  it('stays silent and computes nothing outside development builds', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const details = vi.fn(() => 'details');
    trace('step', details);
    expect(log).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('withoutUrls', () => {
  it('cuts every URL out of an error message', () => {
    expect(
      withoutUrls(
        new Error('Cannot access contents of url "https://kaf.example.edu/p/1/ks/abc?x=1".'),
      ),
    ).toBe('Cannot access contents of url "<url>".');
    expect(withoutUrls('Frame with ID 0 is showing error page chrome-error://chromewebdata/')).toBe(
      'Frame with ID 0 is showing error page <url>',
    );
    expect(withoutUrls('No tab with id: 4.')).toBe('No tab with id: 4.');
  });
});
