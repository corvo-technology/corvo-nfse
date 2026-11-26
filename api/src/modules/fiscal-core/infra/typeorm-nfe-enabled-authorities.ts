import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { NfeEnabledAuthorities } from '../domain/nfe-enabled-authorities';
import { NfeEnabledAuthorityOrmEntity } from './nfe-enabled-authority.orm-entity';

@Injectable()
export class TypeormNfeEnabledAuthorities implements NfeEnabledAuthorities {
  constructor(
    @InjectRepository(NfeEnabledAuthorityOrmEntity)
    private readonly rows: Repository<NfeEnabledAuthorityOrmEntity>,
  ) {}

  async isEnabled(uf: string, model: 55 | 65, tpAmb: 1 | 2): Promise<boolean> {
    return this.rows.existsBy({ uf: uf.toUpperCase(), model, tpAmb });
  }
}
