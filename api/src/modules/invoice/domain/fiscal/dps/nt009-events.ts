/**
 * NT 009 release 1 (XSD 20261020): national taxation codes of item 99 that
 * are IBS/CBS taxable events without ISSQN (99.02 to 99.04). They only exist
 * in the `nt009-r1` layout and, like 99.01.01 (E0532), carry
 * `tribISSQN = 4` (não incidência), no ISS rate, no ISS withholding and no
 * ISS base adjustment.
 */
export const NT009_R1_IBSCBS_ONLY_EVENTS: Readonly<Record<string, string>> = {
  '990201':
    'Operações com bens imateriais não classificados em itens anteriores',
  '990301': 'Locação de bens imóveis',
  '990302': 'Cessão onerosa de bens imóveis',
  '990303': 'Arrendamento de bens imóveis',
  '990304': 'Servidão, cessão de uso ou de espaço de bens imóveis',
  '990305': 'Permissão de uso ou direito de passagem de bens imóveis',
  '990401': 'Locação de bens móveis',
};

export const isNt009IbsCbsOnlyEvent = (serviceCode: string): boolean =>
  Object.hasOwn(NT009_R1_IBSCBS_ONLY_EVENTS, serviceCode);
