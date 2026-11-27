import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Only the text of the "Sem plano" description changes (5 welcome notes). No balance is touched. */
export class WelcomeNotesPlanText1793950000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      UPDATE ${this.schema(runner)}.plans
      SET description = 'Sem plano ativo: 5 notas grátis para conta nova e notas avulsas', updated_at = now()
      WHERE slug = 'free'
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      UPDATE ${this.schema(runner)}.plans
      SET description = 'Sem plano ativo: primeira nota grátis e notas avulsas', updated_at = now()
      WHERE slug = 'free'
    `);
  }
}
