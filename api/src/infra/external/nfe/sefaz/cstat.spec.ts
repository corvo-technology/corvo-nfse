import {
  CSTAT_MESSAGES,
  classifyCstat,
  explainCstat,
  REJECTION_HINTS,
} from './cstat';

describe('classifyCstat', () => {
  it.each([
    ['100', 'authorized'],
    ['150', 'authorized'],
    ['110', 'denied'],
    ['301', 'denied'],
    ['302', 'denied'],
    ['303', 'denied'],
    ['204', 'duplicate'],
    ['217', 'not_found'],
    ['108', 'unavailable'],
    ['109', 'unavailable'],
    ['103', 'processing'],
    ['105', 'processing'],
    ['225', 'rejected'],
    ['539', 'rejected'],
    ['778', 'rejected'],
    ['999', 'rejected'],
  ] as const)('%s is %s', (cStat, expected) => {
    expect(classifyCstat(cStat)).toBe(expected);
  });
});

describe('rejection hints', () => {
  it.each(['204', '225', '539', '778', '897'])('has a hint for %s', (code) => {
    expect(explainCstat(code)).toBeTruthy();
    expect(REJECTION_HINTS[code]).toMatch(/\./);
  });

  it('has no hint for an unknown code', () => {
    expect(explainCstat('1')).toBeUndefined();
  });

  it('has the wording of the codes the simulator uses', () => {
    for (const code of ['100', '302', '225', '539', '778', '204', '108'])
      expect(CSTAT_MESSAGES[code]).toBeTruthy();
  });
});
