import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Mirrors `nfe_document_items`. Numerics are strings: they never go through a JS float. */
@Entity('nfe_document_items')
export class NfeDocumentItemOrmEntity {
  @PrimaryColumn({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @PrimaryColumn({ name: 'n_item', type: 'smallint' })
  nItem!: number;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 60 })
  code!: string;

  @Column({ type: 'varchar', length: 14, nullable: true })
  gtin!: string | null;

  @Column({ type: 'varchar', length: 120 })
  description!: string;

  @Column({ type: 'char', length: 8 })
  ncm!: string;

  @Column({ type: 'char', length: 7, nullable: true })
  cest!: string | null;

  @Column({ type: 'char', length: 4 })
  cfop!: string;

  @Column({ type: 'varchar', length: 6 })
  unit!: string;

  @Column({ type: 'numeric', precision: 15, scale: 4 })
  quantity!: string;

  @Column({ name: 'unit_price', type: 'numeric', precision: 21, scale: 10 })
  unitPrice!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  total!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2, default: 0 })
  discount!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2, default: 0 })
  freight!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2, default: 0 })
  insurance!: string;

  @Column({ type: 'numeric', precision: 15, scale: 2, default: 0 })
  other!: string;

  @Column({ type: 'smallint' })
  origin!: number;

  @Column({ type: 'varchar', length: 3 })
  csosn!: string;

  @Column({ name: 'pis_cst', type: 'varchar', length: 2 })
  pisCst!: string;

  @Column({ name: 'cofins_cst', type: 'varchar', length: 2 })
  cofinsCst!: string;

  @Column({ name: 'ibs_cbs', type: 'jsonb', nullable: true })
  ibsCbs!: Record<string, unknown> | null;
}
