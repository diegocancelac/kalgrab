import { describe, expect, it } from 'vitest';
import { readPopupRequest, type Sender } from '../lib/extension-messages';

const ID = 'kalgrabextensionid';
const popup: Sender = { id: ID };

describe('readPopupRequest', () => {
  it('reads a scan request from the popup', () => {
    expect(readPopupRequest({ type: 'scan', tabId: 4 }, popup, ID)).toEqual({
      type: 'scan',
      tabId: 4,
    });
  });

  it('drops fields it does not know', () => {
    expect(readPopupRequest({ type: 'scan', tabId: 4, frameId: 2 }, popup, ID)).toEqual({
      type: 'scan',
      tabId: 4,
    });
  });

  it('refuses requests from a tab or another extension', () => {
    const request = { type: 'scan', tabId: 4 };
    expect(readPopupRequest(request, { id: ID, tab: { id: 4 } }, ID)).toBe(null);
    expect(readPopupRequest(request, { id: 'another-extension' }, ID)).toBe(null);
    expect(readPopupRequest(request, {}, ID)).toBe(null);
  });

  it('refuses malformed requests', () => {
    const malformed = [
      null,
      'scan',
      { type: 'scan' },
      { type: 'scan', tabId: '4' },
      { type: 'scan', tabId: -1 },
      { type: 'scan', tabId: 1.5 },
      { type: 'download', tabId: 4 },
    ];
    for (const value of malformed) {
      expect(readPopupRequest(value, popup, ID)).toBe(null);
    }
  });
});
