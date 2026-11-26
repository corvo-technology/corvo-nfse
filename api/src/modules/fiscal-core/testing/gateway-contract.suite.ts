import type { GatewayOutcome } from '../domain/gateway-outcome';
import type {
  FiscalDocumentGateway,
  SigningContext,
} from '../domain/ports/gateway.port';

export interface GatewayContractFixtures<D> {
  authorized: D;
  rejected: D;
  timeout: D;
  denied?: D;
  consultKey: string;
  ctx: SigningContext;
}

/**
 * Liskov suite: every adapter of `FiscalDocumentGateway` must behave the same way for the same
 * business situation. Adapters never throw for a business result, and a timeout is never a
 * rejection.
 */
export function describeGatewayContract<D>(
  name: string,
  make: () => FiscalDocumentGateway<D> | Promise<FiscalDocumentGateway<D>>,
  fixtures: GatewayContractFixtures<D>,
): void {
  describe(`gateway contract: ${name}`, () => {
    let gateway: FiscalDocumentGateway<D>;
    beforeEach(async () => {
      gateway = await make();
    });

    const settle = async <T>(
      call: () => Promise<GatewayOutcome<T>>,
    ): Promise<GatewayOutcome<T>> => {
      // A thrown error here is the contract violation: the test fails with it.
      return call();
    };

    it('authorizes a valid document', async () => {
      const outcome = await settle(() =>
        gateway.issuer.issue(fixtures.authorized, fixtures.ctx),
      );
      expect(outcome.kind).toBe('ok');
      if (outcome.kind === 'ok') expect(outcome.value.accessKey).toBeTruthy();
    });

    it('turns a rejection code into rejected with a code', async () => {
      const outcome = await settle(() =>
        gateway.issuer.issue(fixtures.rejected, fixtures.ctx),
      );
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind === 'rejected') expect(outcome.code).toBeTruthy();
    });

    it('turns a timeout into uncertain, never rejected', async () => {
      const outcome = await settle(() =>
        gateway.issuer.issue(fixtures.timeout, fixtures.ctx),
      );
      expect(outcome.kind).toBe('uncertain');
      if (outcome.kind === 'uncertain') expect(outcome.reason).toBe('timeout');
    });

    it('consulting twice gives the same result', async () => {
      const first = await settle(() =>
        gateway.consult.consultByKey(fixtures.consultKey, fixtures.ctx),
      );
      const second = await settle(() =>
        gateway.consult.consultByKey(fixtures.consultKey, fixtures.ctx),
      );
      expect(second).toEqual(first);
    });

    // Only adapters whose authority can deny (NF-e) supply a denial fixture; the others have none.
    if (fixtures.denied !== undefined) {
      const denied = fixtures.denied;
      it('turns a denial into denied', async () => {
        const outcome = await settle(() =>
          gateway.issuer.issue(denied, fixtures.ctx),
        );
        expect(outcome.kind).toBe('denied');
      });
    }
  });
}
