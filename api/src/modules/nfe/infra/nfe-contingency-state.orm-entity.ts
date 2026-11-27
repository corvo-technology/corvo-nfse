import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('nfe_contingency_states')
@Check('ck_nfe_contingency_states_tp_amb', `"tp_amb" IN (1, 2)`)
@Check('ck_nfe_contingency_states_mode', `"mode" IN ('none', 'svc')`)
export class NfeContingencyStateOrmEntity {
  @PrimaryColumn({ type: 'char', length: 2 })
  uf!: string;

  @PrimaryColumn({ name: 'tp_amb', type: 'smallint' })
  tpAmb!: number;

  @Column({ type: 'varchar', length: 10, default: 'none' })
  mode!: string;

  @Column({ name: 'entered_at', type: 'timestamptz', nullable: true })
  enteredAt!: Date | null;

  @Column({ name: 'dh_cont', type: 'varchar', length: 25, nullable: true })
  dhCont!: string | null;

  @Column({ name: 'x_just', type: 'varchar', length: 256, nullable: true })
  xJust!: string | null;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
