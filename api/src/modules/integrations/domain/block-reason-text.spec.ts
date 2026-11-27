import { BLOCK_REASON_TEXT } from './block-reason-text';

describe('BLOCK_REASON_TEXT', () => {
  it('explains what happened and what to do for every reason, in plain words', () => {
    for (const [reason, text] of Object.entries(BLOCK_REASON_TEXT)) {
      expect(text.title.length).toBeGreaterThan(10);
      expect(text.action.length).toBeGreaterThan(3);
      expect(`${reason} ${text.title}`).not.toMatch(/undefined|\[object/);
    }
    expect(BLOCK_REASON_TEXT.customer_tax_id_missing.title).toContain('CPF');
  });
});
