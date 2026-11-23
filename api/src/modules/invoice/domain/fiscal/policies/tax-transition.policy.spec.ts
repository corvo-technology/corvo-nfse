import { TaxTransitionPolicy } from './tax-transition.policy';
import { RULES_VERSION, TAX_RULES } from './rules';

describe('TaxTransitionPolicy', () => {
  it('constructs from TAX_RULES and exposes the version', () => {
    const policy = new TaxTransitionPolicy();
    expect(policy.rulesVersion).toBe('2026.11-r1');
    expect(RULES_VERSION).toBe('2026.11-r1');
  });

  it('selects the 2026 test-phase rule on dates inside its validity', () => {
    const policy = new TaxTransitionPolicy();
    for (const date of ['2026-01-01', '2026-10-14', '2026-12-31']) {
      const result = policy.select('ibscbs.test-phase', date);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.ruleKey).toBe('ibscbs.test-phase');
      expect(typeof result.value.parameters.cbsNominalPercent).toBe('string');
      expect(typeof result.value.parameters.ibsNominalPercent).toBe('string');
      expect(result.value.parameters.collectionWaived).toBe(true);
      expect(result.value.parameters.excludesSimplesNacional).toBe(true);
    }
  });

  it('fails with TAX_RULE_NOT_EFFECTIVE when no rule covers the date', () => {
    const policy = new TaxTransitionPolicy(
      TAX_RULES.filter((r) => r.ruleKey !== 'ibscbs.test-phase'),
    );
    const result = policy.select('ibscbs.test-phase', '2026-05-01');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.code).toBe('TAX_RULE_NOT_EFFECTIVE');
    expect(result.error.details.ruleKey).toBe('ibscbs.test-phase');
    expect(result.error.details.date).toBe('2026-05-01');
  });

  it('exposes rounding defaults as HALF_UP with 2 places', () => {
    const policy = new TaxTransitionPolicy();
    const result = policy.select('rounding.default', '2026-10-14');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.parameters.mode).toBe('HALF_UP');
    expect(typeof result.value.parameters.places).toBe('number');
    expect(result.value.parameters.places).toBe(2);
  });

  it('drives ibsCbsInformation from general/specific dates and Sefin tolerance', () => {
    const policy = new TaxTransitionPolicy();
    const before = policy.ibsCbsInformation('060101', '2026-09-30');
    expect(before.phase).toBe('NOT_YET_REQUIRED');
    expect(before.toleratedBySefin).toBe(true);
    expect(before.rule.ruleKey).toBe('nfse.ibscbs-information');

    const onGeneral = policy.ibsCbsInformation('999999', '2026-10-01');
    expect(onGeneral.phase).toBe('REQUIRED');
    expect(onGeneral.toleratedBySefin).toBe(true);

    // Ato Conjunto nº 7/2026: o 01/12/2026 deixou de ser uma data do ato, e a
    // regra geral (alínea "d") continua valendo para códigos fora da lista.
    const onFormerDate = policy.ibsCbsInformation('999999', '2026-12-01');
    expect(onFormerDate.phase).toBe('REQUIRED');
    expect(onFormerDate.toleratedBySefin).toBe(true);

    const afterTolerance = policy.ibsCbsInformation('060101', '2027-01-01');
    expect(afterTolerance.phase).toBe('REQUIRED');
    expect(afterTolerance.toleratedBySefin).toBe(false);
  });

  it('general rule wins on the boundary date 2026-10-01', () => {
    const policy = new TaxTransitionPolicy([...TAX_RULES, TAX_RULES[1]]);
    const result = policy.select('nfse.ibscbs-information', '2026-10-01');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.parameters.generalFrom).toBe('2026-10-01');
    expect(result.value.parameters.specificCategoriesFrom).toBe('2027-03-01');
  });

  it('keeps Simples IBS/CBS effective from 2027-01-01', () => {
    const policy = new TaxTransitionPolicy();
    const before = policy.select('simples.ibscbs-effective', '2026-12-31');
    expect(before.ok).toBe(true);
    const result = policy.select('simples.ibscbs-effective', '2027-01-01');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.parameters.effectiveFrom).toBe('2027-01-01');
  });

  describe('datas do Ato Conjunto RFB/CGIBS nº 7/2026', () => {
    const parameters = () => {
      const result = new TaxTransitionPolicy().select(
        'nfse.ibscbs-information',
        '2026-11-23',
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.value.parameters;
    };

    it('mantém a regra geral em 01/10/2026 e põe as categorias específicas em 01/03/2027', () => {
      expect(parameters().generalFrom).toBe('2026-10-01');
      expect(parameters().specificCategoriesFrom).toBe('2027-03-01');
    });

    it('regra geral: não exigida na véspera e exigida no dia 01/10/2026', () => {
      const policy = new TaxTransitionPolicy();
      expect(policy.ibsCbsInformation('999999', '2026-09-30').phase).toBe(
        'NOT_YET_REQUIRED',
      );
      expect(policy.ibsCbsInformation('999999', '2026-10-01').phase).toBe(
        'REQUIRED',
      );
    });

    it('categoria específica: não exigida em 28/02/2027 e exigida em 01/03/2027', () => {
      const [base] = TAX_RULES.filter(
        (r) => r.ruleKey === 'nfse.ibscbs-information',
      );
      if (base.ruleKey !== 'nfse.ibscbs-information')
        throw new Error('regra inesperada');
      const policy = new TaxTransitionPolicy([
        {
          ...base,
          parameters: {
            ...base.parameters,
            specificCategoryServiceCodes: ['010301'],
          },
        },
      ]);
      expect(policy.ibsCbsInformation('010301', '2027-02-28').phase).toBe(
        'NOT_YET_REQUIRED',
      );
      expect(policy.ibsCbsInformation('010301', '2027-03-01').phase).toBe(
        'REQUIRED',
      );
      expect(policy.ibsCbsInformation('999999', '2027-02-28').phase).toBe(
        'REQUIRED',
      );
    });

    it('Simples: efeitos em 01/01/2027, na véspera ainda não', () => {
      const policy = new TaxTransitionPolicy();
      const eve = policy.select('simples.ibscbs-effective', '2026-12-31');
      const day = policy.select('simples.ibscbs-effective', '2027-01-01');
      if (!eve.ok || !day.ok) throw new Error('regra ausente');
      expect(eve.value.parameters.effectiveFrom).toBe('2027-01-01');
      expect('2026-12-31' >= eve.value.parameters.effectiveFrom).toBe(false);
      expect('2027-01-01' >= day.value.parameters.effectiveFrom).toBe(true);
    });
  });
});
