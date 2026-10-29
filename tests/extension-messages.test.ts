import { describe, expect, it } from 'vitest';
import { readExtensionPageMessage, readFrameMessage, type Sender } from '../lib/extension-messages';
import { CHANNEL, VERSION } from '../lib/messages';

const ID = 'kalgrabextensionid';
const contentScript: Sender = { id: ID, tab: { id: 4 }, frameId: 2 };
const popup: Sender = { id: ID };

const fetchFailed = {
  channel: CHANNEL,
  version: VERSION,
  type: 'fetch-failed',
  origin: 'https://cdnapisec.kaltura.com',
};

describe('readFrameMessage', () => {
  it('reads a reset and a valid page message with the frame they came from', () => {
    expect(readFrameMessage({ type: 'frame-reset' }, contentScript, ID)).toEqual({
      tabId: 4,
      frameId: 2,
      message: { type: 'frame-reset' },
    });
    expect(
      readFrameMessage({ type: 'page-message', message: fetchFailed }, contentScript, ID),
    ).toEqual({ tabId: 4, frameId: 2, message: { type: 'page-message', message: fetchFailed } });
  });

  it('accepts the top frame', () => {
    expect(
      readFrameMessage({ type: 'frame-reset' }, { ...contentScript, frameId: 0 }, ID),
    ).not.toBe(null);
  });

  it('validates the page message again', () => {
    const forged = [
      { ...fetchFailed, origin: 'javascript:alert(1)' },
      { ...fetchFailed, version: VERSION + 1 },
      { ...fetchFailed, ks: 'x' },
      undefined,
    ];
    for (const message of forged) {
      expect(readFrameMessage({ type: 'page-message', message }, contentScript, ID)).toBe(null);
    }
  });

  it('only accepts frame messages from this extension, in a tab and a frame', () => {
    const senders: Sender[] = [
      popup,
      { ...contentScript, id: 'another-extension' },
      { ...contentScript, tab: {} },
      { id: ID, tab: { id: 4 } },
      { ...contentScript, frameId: -1 },
    ];
    for (const sender of senders) {
      expect(readFrameMessage({ type: 'frame-reset' }, sender, ID)).toBe(null);
    }
  });

  it('ignores anything else', () => {
    for (const value of [null, 'frame-reset', [], {}, { type: 'download' }]) {
      expect(readFrameMessage(value, contentScript, ID)).toBe(null);
    }
  });
});

describe('readExtensionPageMessage', () => {
  const download = {
    type: 'download',
    tabId: 4,
    frameId: 0,
    entryId: '1_abcd1234',
    flavorId: '1_flav0360',
  };

  it('reads an access request and a download from the popup', () => {
    expect(readExtensionPageMessage({ type: 'access-requested', tabId: 4 }, popup, ID)).toEqual({
      type: 'access-requested',
      tabId: 4,
    });
    expect(readExtensionPageMessage(download, popup, ID)).toEqual(download);
  });

  it('drops fields it does not know', () => {
    expect(
      readExtensionPageMessage({ ...download, url: 'https://x.example.com' }, popup, ID),
    ).toEqual(download);
  });

  it('refuses requests from content scripts and other extensions', () => {
    expect(readExtensionPageMessage(download, contentScript, ID)).toBe(null);
    expect(readExtensionPageMessage(download, { id: 'another-extension' }, ID)).toBe(null);
  });

  it('refuses malformed requests', () => {
    const malformed = [
      { ...download, tabId: '4' },
      { ...download, tabId: 1.5 },
      { ...download, frameId: -1 },
      { ...download, entryId: '' },
      { ...download, flavorId: 'x'.repeat(65) },
      { type: 'access-requested' },
      { type: 'access-requested', tabId: NaN },
      { type: 'unknown' },
      null,
    ];
    for (const value of malformed) {
      expect(readExtensionPageMessage(value, popup, ID)).toBe(null);
    }
  });
});
