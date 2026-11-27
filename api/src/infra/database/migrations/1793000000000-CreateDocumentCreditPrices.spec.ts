import type { QueryRunner } from 'typeorm';
import { CreateDocumentCreditPrices1793000000000 } from './1793000000000-CreateDocumentCreditPrices';

function fakeRunner() {
  const queries: string[] = [];
  const runner = {
    connection: {
      options: { schema: 'corvo' },
      driver: { escape: (v: string) => `"${v}"` },
    },
    query: jest.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve(undefined);
    }),
  } as unknown as QueryRunner;
  return { runner, queries };
}

describe('CreateDocumentCreditPrices', () => {
  it('creates the global price table with the seed and the reservation type column', async () => {
    const { runner, queries } = fakeRunner();
    await new CreateDocumentCreditPrices1793000000000().up(runner);
    const sql = queries.join('\n');
    expect(sql).toMatch(/CREATE TABLE "corvo"\.document_credit_prices/);
    expect(sql).toMatch(/CHECK \(document_type IN \('nfse','nfe','nfce'\)\)/);
    expect(sql).toMatch(/CHECK \(credits > 0\)/);
    expect(sql).toMatch(/\('nfse', 1\), \('nfe', 1\), \('nfce', 1\)/);
    expect(sql).toMatch(
      /ADD COLUMN reserved_document_type varchar\(10\) NOT NULL DEFAULT 'nfse'/,
    );
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it('down undoes both changes', async () => {
    const { runner, queries } = fakeRunner();
    await new CreateDocumentCreditPrices1793000000000().down(runner);
    const sql = queries.join('\n');
    expect(sql).toMatch(/DROP COLUMN reserved_document_type/);
    expect(sql).toMatch(/DROP TABLE "corvo"\.document_credit_prices/);
  });
});
