import {
  SEFAZ_TRUST_ROOTS,
  SefazSoapClient,
} from '@/infra/external/nfe/sefaz/soap-client';
import type { GovRouteSelector } from '@/modules/portal-reachability/gov-route.selector';

/**
 * The SEFAZ client of the NF-e and the NFC-e. With a route selector, a call goes through the backup
 * proxy only while our network cannot reach the government (and only to an allowlisted host); without
 * one, always direct. The mTLS certificate travels inside the tunnel, so it stays end to end.
 */
export function createSefazSoapClient(
  routes?: Pick<GovRouteSelector, 'dispatcherFor'>,
): SefazSoapClient {
  return new SefazSoapClient(
    routes
      ? {
          proxyFor: (host, certificate) =>
            routes.dispatcherFor(
              host,
              'sefaz',
              { keyPem: certificate.keyPem, certPem: certificate.certPem },
              SEFAZ_TRUST_ROOTS,
            ),
        }
      : {},
  );
}
