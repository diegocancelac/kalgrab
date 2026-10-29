import { describe, expect, it } from 'vitest';
import { readPlayerSession, readPlayerSessions } from '../lib/kaltura/player-v7';

// Never a real session or account: the same fake values as the fixtures.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// The shape Player v7 has in a KAF frame: provider.env.serviceUrl ends in /api_v3.
function player(edit?: (config: Json) => void): Json {
  const config: Json = {
    provider: {
      partnerId: 1234567,
      uiConfId: 7654321,
      ks: FAKE_KS,
      log: { level: 'ERROR' },
      env: {
        serviceUrl: 'https://www.kaltura.com/api_v3',
        cdnUrl: 'https://cdnapisec.kaltura.com',
        statsServiceUrl: 'https://stats.kaltura.com/api_v3',
      },
    },
    sources: { id: '1_abcd1234', metadata: { name: 'Sample lecture' } },
  };
  edit?.(config);
  return { config };
}

describe('readPlayerSession', () => {
  it('reads partnerId, ks, serviceUrl, cdnUrl and the entry of a v7 player', () => {
    expect(readPlayerSession(player())).toEqual({
      partnerId: 1234567,
      serviceUrl: 'https://www.kaltura.com/api_v3',
      allowedOrigins: ['https://www.kaltura.com/api_v3', 'https://cdnapisec.kaltura.com'],
      ks: FAKE_KS,
      entryId: '1_abcd1234',
    });
  });

  it('allows only serviceUrl when cdnUrl is missing or not an http(s) URL', () => {
    for (const cdnUrl of [undefined, '', 'javascript:alert(1)', 'not a url', 42]) {
      const session = readPlayerSession(player((c) => (c['provider'].env.cdnUrl = cdnUrl)));
      expect(session?.allowedOrigins, String(cdnUrl)).toEqual(['https://www.kaltura.com/api_v3']);
    }
  });

  it('returns null without what a request needs', () => {
    const broken: [string, (config: Json) => void][] = [
      ['no ks', (c) => delete c['provider'].ks],
      ['empty ks', (c) => (c['provider'].ks = '')],
      ['ks not a string', (c) => (c['provider'].ks = { ks: FAKE_KS })],
      ['partnerId a string', (c) => (c['provider'].partnerId = '1234567')],
      ['partnerId zero', (c) => (c['provider'].partnerId = 0)],
      ['partnerId fractional', (c) => (c['provider'].partnerId = 1.5)],
      ['no env', (c) => delete c['provider'].env],
      ['no serviceUrl', (c) => delete c['provider'].env.serviceUrl],
      ['serviceUrl not http(s)', (c) => (c['provider'].env.serviceUrl = 'ftp://x.example.com')],
      ['no sources', (c) => delete c['sources']],
      ['no entry loaded', (c) => (c['sources'] = {})],
      ['entryId with a slash', (c) => (c['sources'].id = '1_a/../b')],
      ['entryId too long', (c) => (c['sources'].id = 'a'.repeat(65))],
      ['no provider', (c) => delete c['provider']],
    ];
    for (const [name, edit] of broken) {
      expect(readPlayerSession(player(edit)), name).toBe(null);
    }
  });

  it('returns null for things that are not players, and for getters that throw', () => {
    for (const value of [undefined, null, 'player', [], {}, { config: 'x' }]) {
      expect(readPlayerSession(value)).toBe(null);
    }
    const hostile = {
      get config() {
        throw new Error('no');
      },
    };
    expect(readPlayerSession(hostile)).toBe(null);
  });
});

describe('readPlayerSessions', () => {
  it('reads every player from getPlayers() and skips the unusable ones', () => {
    const second = player((c) => (c['sources'].id = '1_efgh5678'));
    const KalturaPlayer = {
      getPlayers: () => ({
        kplayer: player(),
        other: second,
        empty: player((c) => delete c['sources']),
      }),
    };
    expect(readPlayerSessions(KalturaPlayer).map((s) => s.entryId)).toEqual([
      '1_abcd1234',
      '1_efgh5678',
    ]);
  });

  it('calls getPlayers on KalturaPlayer itself', () => {
    const KalturaPlayer = {
      players: { kplayer: player() },
      getPlayers(this: { players: unknown }) {
        return this.players;
      },
    };
    expect(readPlayerSessions(KalturaPlayer)).toHaveLength(1);
  });

  it('returns nothing before the library loads or when getPlayers misbehaves', () => {
    const throwing = {
      getPlayers: () => {
        throw new Error('no');
      },
    };
    for (const value of [
      undefined,
      null,
      {},
      { getPlayers: 1 },
      { getPlayers: () => null },
      throwing,
    ]) {
      expect(readPlayerSessions(value)).toEqual([]);
    }
  });
});
