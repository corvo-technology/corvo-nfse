import { selectRule, type IntegrationRule } from './integration-rule';

const rule = (id: string, product: string | null): IntegrationRule => ({
  id,
  tenantId: 't',
  connectionId: 'c',
  externalProductId: product,
  service: { code: '010101' },
  sendEmail: false,
  allowAnonymousCustomer: false,
  cancelOnRefund: false,
});
const item = (externalProductId: string | null) => ({
  externalProductId,
  description: null,
  quantity: 1,
});

describe('selectRule', () => {
  it('uses the default rule when the operation has no known product', () => {
    expect(selectRule([rule('d', null)], [])).toEqual({
      rule: rule('d', null),
    });
    expect(selectRule([rule('d', null)], [item(null)])).toEqual({
      rule: rule('d', null),
    });
  });
  it('uses the product rule when there is one', () => {
    const rules = [rule('d', null), rule('p', 'prod1')];
    expect(selectRule(rules, [item('prod1')])).toEqual({
      rule: rule('p', 'prod1'),
    });
  });
  it('falls back to the default rule for an unknown product', () => {
    expect(
      selectRule([rule('d', null), rule('p', 'prod1')], [item('other')]),
    ).toEqual({ rule: rule('d', null) });
  });
  it('no_rule when nothing applies', () => {
    expect(selectRule([rule('p', 'prod1')], [item('other')])).toEqual({
      error: 'no_rule',
    });
    expect(selectRule([], [])).toEqual({ error: 'no_rule' });
  });
  it('ambiguous_rule when items resolve to different rules', () => {
    const rules = [rule('a', 'p1'), rule('b', 'p2')];
    expect(selectRule(rules, [item('p1'), item('p2')])).toEqual({
      error: 'ambiguous_rule',
    });
  });
  it('one rule for several items of the same product', () => {
    expect(selectRule([rule('a', 'p1')], [item('p1'), item('p1')])).toEqual({
      rule: rule('a', 'p1'),
    });
  });
});
