import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { NfeContingencyStateOrmEntity } from './nfe-contingency-state.orm-entity';

export interface NfeContingencyState {
  mode: 'none' | 'svc';
  dhCont: string | null;
  xJust: string | null;
}

export interface ActiveSvc {
  uf: Uf;
  tpAmb: 1 | 2;
  enteredAt: Date | null;
  dhCont: string | null;
}

const NONE: NfeContingencyState = { mode: 'none', dhCont: null, xJust: null };

/**
 * The SVC state per UF and environment (global, no RLS). `enter` and `exit` are single statements
 * that only win from the opposite state, so two workers racing announce a transition once.
 */
@Injectable()
export class TypeormNfeContingencyStates {
  constructor(
    @InjectRepository(NfeContingencyStateOrmEntity)
    private readonly rows: Repository<NfeContingencyStateOrmEntity>,
  ) {}

  async get(uf: string, tpAmb: 1 | 2): Promise<NfeContingencyState> {
    const row = await this.rows.findOneBy({ uf: uf.toUpperCase(), tpAmb });
    if (!row || row.mode !== 'svc') return NONE;
    return { mode: 'svc', dhCont: row.dhCont, xJust: row.xJust };
  }

  /** True when this call moved the UF from `none` to `svc`. */
  async enter(
    uf: string,
    tpAmb: 1 | 2,
    state: { dhCont: string; xJust: string },
    now: Date,
  ): Promise<boolean> {
    const result: unknown = await this.rows.query(
      `INSERT INTO ${this.table()} AS st (uf, tp_amb, mode, entered_at, dh_cont, x_just, updated_at)
       VALUES ($1, $2, 'svc', $3, $4, $5, $3)
       ON CONFLICT (uf, tp_amb) DO UPDATE
         SET mode = 'svc', entered_at = $3, dh_cont = $4, x_just = $5, updated_at = $3
         WHERE st.mode = 'none'
       RETURNING uf`,
      [uf.toUpperCase(), tpAmb, now, state.dhCont, state.xJust],
    );
    return Array.isArray(result) && result.length > 0;
  }

  /** True when this call moved the UF from `svc` to `none`. */
  async exit(uf: string, tpAmb: 1 | 2, now: Date): Promise<boolean> {
    const result = await this.rows
      .createQueryBuilder()
      .update()
      .set({
        mode: 'none',
        enteredAt: null,
        dhCont: null,
        xJust: null,
        updatedAt: now,
      })
      .where('uf = :uf AND tp_amb = :tpAmb AND mode = :mode', {
        uf: uf.toUpperCase(),
        tpAmb,
        mode: 'svc',
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async listActive(): Promise<ActiveSvc[]> {
    const found = await this.rows.findBy({ mode: 'svc' });
    return found
      .map((row) => ({
        uf: row.uf as Uf,
        tpAmb: row.tpAmb as 1 | 2,
        enteredAt: row.enteredAt,
        dhCont: row.dhCont,
      }))
      .sort((a, b) => a.uf.localeCompare(b.uf) || a.tpAmb - b.tpAmb);
  }

  private table(): string {
    return this.rows.metadata.tablePath;
  }
}
