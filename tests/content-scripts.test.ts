import { describe, expect, it } from 'vitest';
import { contentScriptRegistrations } from '../lib/content-scripts';

describe('contentScriptRegistrations', () => {
  it('registers the bridge before the player, in every frame from document_start', () => {
    const scripts = contentScriptRegistrations(['*://*/*']);
    expect(scripts).toEqual([
      {
        id: 'bridge',
        js: ['/content-scripts/bridge.js'],
        world: 'ISOLATED',
        matches: ['*://*/*'],
        allFrames: true,
        matchOriginAsFallback: true,
        runAt: 'document_start',
      },
      {
        id: 'player',
        js: ['/content-scripts/player.js'],
        world: 'MAIN',
        matches: ['*://*/*'],
        allFrames: true,
        matchOriginAsFallback: true,
        runAt: 'document_start',
      },
    ]);
  });

  it('registers nothing without host access', () => {
    expect(contentScriptRegistrations([])).toEqual([]);
  });

  it('matches only the granted hosts', () => {
    const [bridge] = contentScriptRegistrations([
      'https://kaf.example.edu/*',
      'https://*.blackboard.com/*',
    ]);
    expect(bridge?.matches).toEqual(['https://kaf.example.edu/*', 'https://*.blackboard.com/*']);
  });

  it('widens paths to "/*", as matchOriginAsFallback requires, and drops duplicates', () => {
    const [bridge] = contentScriptRegistrations([
      'https://kaf.example.edu/videos/*',
      'https://kaf.example.edu/*',
    ]);
    expect(bridge?.matches).toEqual(['https://kaf.example.edu/*']);
  });

  it('ignores patterns that are not http(s) hosts', () => {
    expect(contentScriptRegistrations(['<all_urls>', 'file:///*', 'chrome://*/*'])).toEqual([]);
  });
});
