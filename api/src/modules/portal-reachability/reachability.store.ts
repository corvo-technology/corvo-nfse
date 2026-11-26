import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';
import { isOurSide, type PortalHealth } from './reachability.classifier';
import { INITIAL_STATE, type ReachabilityState } from './reachability.state';

const STATE_KEY = 'ops:portal-reachability:state';
const INCIDENTS_KEY = 'ops:portal-reachability:incidents';
const KEEP_INCIDENTS = 20;

export interface PortalIncident {
  health: PortalHealth;
  start: string;
  end: string;
}

/** What the status endpoint shows. */
export interface PortalReachability {
  state: PortalHealth;
  since: string | null;
  /** True when the trouble is on the Corvo side (not the portal being down). */
  ourSide: boolean;
}

/** The monitor's state and the last incidents, in Redis so every replica and restart sees them. */
@Injectable()
export class PortalReachabilityStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async load(): Promise<ReachabilityState> {
    const raw = await this.redis.get(STATE_KEY);
    if (!raw) return INITIAL_STATE;
    try {
      return { ...INITIAL_STATE, ...(JSON.parse(raw) as ReachabilityState) };
    } catch {
      return INITIAL_STATE;
    }
  }

  async save(state: ReachabilityState): Promise<void> {
    await this.redis.set(STATE_KEY, JSON.stringify(state));
  }

  async recordIncident(incident: PortalIncident): Promise<void> {
    await this.redis.lpush(INCIDENTS_KEY, JSON.stringify(incident));
    await this.redis.ltrim(INCIDENTS_KEY, 0, KEEP_INCIDENTS - 1);
  }

  async incidents(limit = 10): Promise<PortalIncident[]> {
    const rows = await this.redis.lrange(INCIDENTS_KEY, 0, limit - 1);
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row) as PortalIncident];
      } catch {
        return [];
      }
    });
  }

  async current(): Promise<PortalReachability> {
    const state = await this.load();
    if (state.phase !== 'incident')
      return { state: 'ok', since: null, ourSide: false };
    return {
      state: state.health,
      since: state.since,
      ourSide: isOurSide(state.health),
    };
  }
}
