/** Public NFS-e consultation page printed on the DANFSE (QR code target). */
export const NFSE_PUBLIC_CONSULTATION_URL = {
  production: 'https://adn.nfse.gov.br/contribuintes/consulta',
  restrictedProduction:
    'https://adn.producaorestrita.nfse.gov.br/contribuintes/consulta',
} as const;

/** Printed on every document and email generated in the test environment. */
export const NFSE_TEST_DISCLAIMER = 'TESTE — SIMULAÇÃO SEM VALIDADE FISCAL';
