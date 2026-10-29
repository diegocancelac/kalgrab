// Reads what is needed from Kaltura Player v7 instances. Everything here is page data: any
// property can be missing, of the wrong type, or a getter that throws.

/** Holds the ks: lives only in the MAIN world and never goes into a message. */
export interface PlayerSession {
  partnerId: number;
  /** As the player has it, usually with the "/api_v3" suffix. */
  serviceUrl: string;
  /** serviceUrl and cdnUrl: the only places withKs may send the ks to. */
  allowedOrigins: string[];
  ks: string;
  entryId: string;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The session of one player with a loaded entry: config.provider has partnerId, ks and
 * env.serviceUrl / env.cdnUrl, and config.sources.id is the entry. Null otherwise.
 */
export function readPlayerSession(player: unknown): PlayerSession | null {
  try {
    if (!isRecord(player) || !isRecord(player['config'])) return null;
    const { provider, sources } = player['config'];
    if (!isRecord(provider) || !isRecord(sources) || !isRecord(provider['env'])) return null;

    const partnerId = provider['partnerId'];
    const ks = provider['ks'];
    const entryId = sources['id'];
    const serviceUrl = httpUrl(provider['env']['serviceUrl']);
    const cdnUrl = httpUrl(provider['env']['cdnUrl']);
    if (
      !Number.isSafeInteger(partnerId) ||
      (partnerId as number) <= 0 ||
      typeof ks !== 'string' ||
      !ks ||
      typeof entryId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(entryId) ||
      !serviceUrl
    ) {
      return null;
    }
    return {
      partnerId: partnerId as number,
      serviceUrl,
      allowedOrigins: cdnUrl ? [serviceUrl, cdnUrl] : [serviceUrl],
      ks,
      entryId,
    };
  } catch {
    return null;
  }
}

/** The sessions of every player on the page, from KalturaPlayer.getPlayers(). */
export function readPlayerSessions(kalturaPlayer: unknown): PlayerSession[] {
  try {
    if (typeof kalturaPlayer !== 'object' || kalturaPlayer === null) return [];
    const { getPlayers } = kalturaPlayer as Json;
    if (typeof getPlayers !== 'function') return [];
    const players: unknown = getPlayers.call(kalturaPlayer);
    if (!isRecord(players)) return [];
    return Object.values(players).flatMap((player) => readPlayerSession(player) ?? []);
  } catch {
    return [];
  }
}
