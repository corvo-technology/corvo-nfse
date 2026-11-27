/**
 * What the connection tests say about the way from the Corvo servers to the government portal.
 *
 * - ok: the NFS-e hosts answer.
 * - portal_down: the government network answers but the NFS-e portal does not (the portal is down).
 * - gov_unreachable_from_us: no government host answers while a site outside the government does
 *   (our provider's route or firewall).
 * - no_internet: nothing answers.
 * - emission_failures: the tests pass but real emissions keep failing to connect.
 */
export type PortalHealth =
  | 'ok'
  | 'portal_down'
  | 'gov_unreachable_from_us'
  | 'no_internet'
  | 'emission_failures';

export interface ProbeResults {
  /** sefin.nfse.gov.br */
  sefin: boolean;
  /** adn.nfse.gov.br */
  adn: boolean;
  /** www.gov.br: a government host that is not the NFS-e portal (control). */
  govControl: boolean;
  /** A host outside the government (control). */
  externalControl: boolean;
  /**
   * One answer per enabled SEFAZ authority (`nfe-sp-2`, `nfce-sp-2`, ...). A SEFAZ that answers
   * proves the government network is reachable, so the NFS-e portal alone is the one that is down.
   */
  authorities?: Record<string, boolean>;
  /**
   * Only when the backup proxy is configured: a tunnel to the Sefin opened through it. Never part of the
   * classification (that one measures the direct route); it only tells whether the backup would work.
   */
  viaProxy?: boolean;
}

export function classifyProbes(results: ProbeResults): PortalHealth {
  if (results.sefin && results.adn) return 'ok';
  const sefazAnswers = Object.values(results.authorities ?? {}).some(Boolean);
  if (results.sefin || results.adn || results.govControl || sefazAnswers)
    return 'portal_down';
  return results.externalControl ? 'gov_unreachable_from_us' : 'no_internet';
}

/** The classifications where the problem is on the Corvo side, not the portal's. */
export function isOurSide(health: PortalHealth): boolean {
  return (
    health === 'gov_unreachable_from_us' ||
    health === 'no_internet' ||
    health === 'emission_failures'
  );
}
