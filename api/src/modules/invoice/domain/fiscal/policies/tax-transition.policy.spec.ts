import { TaxTransitionPolicy } from './tax-transition.policy';
import { RULES_VERSION, TAX_RULES } from './rules';

describe('TaxTransitionPolicy', () => {
  it('constructs from TAX_RULES and exposes the version', () => {
    const policy = new TaxTransitionPolicy()
    expect(policy.rulesVersion).toBe('2026.10-r1')
    expect(RULES_VERSION).toBe('2026.10-r1')
  })

  it('selects the 2026 test-phase rule on dates inside its validity', () => {
    const policy = new TaxTransitionPolicy()
    for (const date of ['2026-01-01', '2026-10-14', '2026-12-31']) {
      const result = policy.select('ibscbs.test-phase', date)
      if (!result.ok) throw new Error(result.error.message)
      expect(result.value.ruleKey).toBe('ibscbs.test-phase')
      expect(typeof result.value.parameters.cbsNominalPercent).toBe('string')
      expect(typeof result.value.parameters.ibsNominalPercent).toBe('string')
      expect(result.value.parameters.collectionWaived).toBe(true)
      expect(result.value.parameters.excludesSimplesNacional).toBe(true)
    }
  })

  it('fails with TAX_RULE_NOT_EFFECTIVE when no rule covers the date', () => {
    const policy = new TaxTransitionPolicy(TAX_RULES.filter((r) => r.ruleKey !== 'ibscbs.test-phase'))
    const result = policy.select('ibscbs.test-phase', '2026-05-01')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected err')
    expect(result.error.code).toBe('TAX_RULE_NOT_EFFECTIVE')
    expect(result.error.details.ruleKey).toBe('ibscbs.test-phase')
    expect(result.error.details.date).toBe('2026-05-01')
  })

  it('exposes rounding defaults as HALF_UP with 2 places', () => {
    const policy = new TaxTransitionPolicy()
    const result = policy.select('rounding.default', '2026-10-14')
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.parameters.mode).toBe('HALF_UP')
    expect(typeof result.value.parameters.places).toBe('number')
    expect(result.value.parameters.places).toBe(2)
  })

  it('drives ibsCbsInformation from general/specific dates and Sefin tolerance', () => {
    const policy = new TaxTransitionPolicy()
    const before = policy.ibsCbsInformation('060101', '2026-09-30')
    expect(before.phase).toBe('NOT_YET_REQUIRED')
    expect(before.toleratedBySefin).toBe(true)
    expect(before.rule.ruleKey).toBe('nfse.ibscbs-information')

    const onGeneral = policy.ibsCbsInformation('999999', '2026-10-01')
    expect(onGeneral.phase).toBe('REQUIRED')
    expect(onGeneral.toleratedBySefin).toBe(true)

    const onSpecific = policy.ibsCbsInformation('999999', '2026-12-01')
    expect(onSpecific.phase).toBe('REQUIRED')
    expect(onSpecific.toleratedBySefin).toBe(true)

    const afterTolerance = policy.ibsCbsInformation('060101', '2027-01-01')
    expect(afterTolerance.phase).toBe('REQUIRED')
    expect(afterTolerance.toleratedBySefin).toBe(false)
  })

  it('general rule wins on the boundary date 2026-10-01', () => {
    const policy = new TaxTransitionPolicy([...TAX_RULES, TAX_RULES[1]])
    const result = policy.select('nfse.ibscbs-information', '2026-10-01')
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.parameters.generalFrom).toBe('2026-10-01')
    expect(result.value.parameters.specificCategoriesFrom).toBe('2026-12-01')
  })

  it('keeps Simples IBS/CBS effective from 2027-01-01', () => {
    const policy = new TaxTransitionPolicy()
    const before = policy.select('simples.ibscbs-effective', '2026-12-31')
    expect(before.ok).toBe(true)
    const result = policy.select('simples.ibscbs-effective', '2027-01-01')
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.parameters.effectiveFrom).toBe('2027-01-01')
  })
})
