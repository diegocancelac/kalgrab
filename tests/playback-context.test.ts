import { describe, expect, it } from 'vitest';
import { buildPlaybackContextRequest } from '../lib/kaltura/playback-context';

// Never a real session. Tests assert with toEqual/toContain; no snapshots, so the value
// is not written to disk.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';

const input = {
  serviceUrl: 'https://cdnapisec.kaltura.com',
  partnerId: 1234567,
  ks: FAKE_KS,
  entryId: '1_abcd1234',
};

describe('buildPlaybackContextRequest', () => {
  it('targets the multirequest endpoint of the service URL', () => {
    expect(buildPlaybackContextRequest(input).url).toBe(
      'https://cdnapisec.kaltura.com/api_v3/service/multirequest',
    );
  });

  it('tolerates a trailing slash and keeps a path prefix', () => {
    const { url } = buildPlaybackContextRequest({
      ...input,
      serviceUrl: 'https://kaltura.example.edu/proxy//',
    });
    expect(url).toBe('https://kaltura.example.edu/proxy/api_v3/service/multirequest');
  });

  it('asks for baseEntry.list and then getPlaybackContext with all flavors', () => {
    const body = JSON.parse(buildPlaybackContextRequest(input).body);
    expect(body['1']).toEqual({
      service: 'baseEntry',
      action: 'list',
      filter: { redirectFromEntryId: '1_abcd1234' },
    });
    expect(body['2']).toEqual({
      service: 'baseEntry',
      action: 'getPlaybackContext',
      entryId: '{1:result:objects:0:id}',
      contextDataParams: { objectType: 'KalturaContextDataParams', flavorTags: 'all' },
    });
  });

  it('sends the session once, at the top level', () => {
    const body = JSON.parse(buildPlaybackContextRequest(input).body);
    expect(body.ks).toBe(FAKE_KS);
    expect(body.partnerId).toBe(1234567);
    expect(body.format).toBe(1);
    expect(body['1'].ks).toBeUndefined();
    expect(body['2'].ks).toBeUndefined();
  });

  it('rejects a bad service URL, a missing ks or a missing entry id', () => {
    expect(() => buildPlaybackContextRequest({ ...input, serviceUrl: 'not a url' })).toThrow();
    expect(() =>
      buildPlaybackContextRequest({ ...input, serviceUrl: 'ftp://x.example.com' }),
    ).toThrow();
    expect(() => buildPlaybackContextRequest({ ...input, ks: '' })).toThrow();
    expect(() => buildPlaybackContextRequest({ ...input, entryId: '' })).toThrow();
  });
});
