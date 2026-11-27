import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'document_credit_prices' })
@Check(
  'ck_document_credit_prices_type',
  `"document_type" IN ('nfse','nfe','nfce')`,
)
@Check('ck_document_credit_prices_credits', `"credits" > 0`)
export class DocumentCreditPriceOrmEntity {
  @PrimaryColumn({ name: 'document_type', type: 'varchar', length: 10 })
  documentType!: string;

  @Column({ type: 'integer' })
  credits!: number;

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  updatedAt!: Date;
}
