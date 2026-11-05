import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** One row per person (normalized e-mail) that already received the first free note. */
@Entity({ name: 'free_note_claims' })
export class FreeNoteClaimOrmEntity {
  @PrimaryColumn({ name: 'email_key', type: 'varchar', length: 320 })
  emailKey!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
