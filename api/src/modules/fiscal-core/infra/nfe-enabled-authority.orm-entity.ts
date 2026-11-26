import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('nfe_enabled_authorities')
@Check('ck_nfe_enabled_authorities_model', `"model" IN (55, 65)`)
@Check('ck_nfe_enabled_authorities_tp_amb', `"tp_amb" IN (1, 2)`)
export class NfeEnabledAuthorityOrmEntity {
  @PrimaryColumn({ type: 'char', length: 2 })
  uf!: string;

  @PrimaryColumn({ type: 'smallint' })
  model!: number;

  @PrimaryColumn({ name: 'tp_amb', type: 'smallint' })
  tpAmb!: number;

  @Column({ name: 'enabled_at', type: 'timestamptz' })
  enabledAt!: Date;

  @Column({ name: 'runbook_ref', type: 'text' })
  runbookRef!: string;
}
