import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Invitations are accepted with a single-use token: only its hash is stored. */
export class AddInvitationTokens1792730000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.tenant_invitations
        ADD COLUMN token_hash varchar(64),
        ADD COLUMN invited_by_user_id uuid,
        ADD COLUMN accepted_at timestamptz,
        ADD COLUMN accepted_by_user_id uuid`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX idx_tenant_invitations_token_hash ON ${schema}.tenant_invitations (token_hash) WHERE token_hash IS NOT NULL`,
    );
    // Old rows have no token and could never be accepted: close them.
    await runner.query(
      `UPDATE ${schema}.tenant_invitations SET status = 'revoked' WHERE status = 'pending' AND token_hash IS NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `DROP INDEX ${schema}.idx_tenant_invitations_token_hash`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.tenant_invitations
        DROP COLUMN token_hash,
        DROP COLUMN invited_by_user_id,
        DROP COLUMN accepted_at,
        DROP COLUMN accepted_by_user_id`,
    );
  }
}
