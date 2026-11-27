import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import type { SigningContext } from '@/modules/fiscal-core/domain/ports/gateway.port';
import { describeGatewayContract } from '@/modules/fiscal-core/testing/gateway-contract.suite';
import { FakeNfseProvider } from './fake-nfse.provider';
import { NfseExternalModule } from './nfse-external.module';
import { NfseGatewayAdapter } from './nfse-gateway.adapter';
import type {
  FiscalIssueResult,
  FiscalProvider,
  IIssuePayload,
} from './nfse-fiscal-provider';

const payload = (invoiceId: string): IIssuePayload => ({
  invoiceId,
  tenantId: 'tenant-1',
  number: 7,
  pfxBuffer: Buffer.alloc(0),
  p12Password: '',
  environment: 'test',
  serie: '1',
  competenceDate: new Date('2026-09-01'),
  issuedAt: new Date('2026-10-09'),
  emitente: {
    cnpj: '11222333000181',
    legalName: 'Empresa Teste',
    codMunicipio: '3550308',
    regime: { opSimpNac: 2, regApTribSN: 1, regEspTrib: 0 },
  },
  tomador: { documento: { CPF: '52998224725' }, nome: 'Cliente' },
  servico: { cTribNac: '010101', descricao: 'Consultoria' },
  valores: { vServ: 100 },
});

/** The simulator always authorizes; scenarios are chosen by the invoice id. */
class ScenarioProvider extends FakeNfseProvider implements FiscalProvider {
  async issue(p: IIssuePayload): Promise<FiscalIssueResult> {
    if (p.invoiceId === 'rejected')
      return {
        success: false,
        errorCode: 'E0001',
        errorMessage: 'Dados inválidos',
        requiresReconciliation: false,
      };
    if (p.invoiceId === 'timeout')
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    return super.issue(p);
  }
}

const ctx = { tpAmb: 2 } as SigningContext;

describeGatewayContract(
  'NfseGatewayAdapter over FakeNfseProvider',
  () => new NfseGatewayAdapter(new ScenarioProvider()),
  {
    authorized: payload('authorized'),
    rejected: payload('rejected'),
    timeout: payload('timeout'),
    consultKey: '1'.repeat(50),
    ctx,
  },
);

describe('NfseGatewayAdapter mapping', () => {
  it('maps a provider that asks for reconciliation to uncertain/server', async () => {
    const provider = {
      issue: jest
        .fn()
        .mockResolvedValue({ success: false, requiresReconciliation: true }),
    } as unknown as FiscalProvider;
    const outcome = await new NfseGatewayAdapter(provider).issuer.issue(
      payload('x'),
      ctx,
    );
    expect(outcome).toEqual({ kind: 'uncertain', reason: 'server' });
  });

  it('maps other exceptions to uncertain/network', async () => {
    const provider = {
      issue: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    } as unknown as FiscalProvider;
    const outcome = await new NfseGatewayAdapter(provider).issuer.issue(
      payload('x'),
      ctx,
    );
    expect(outcome).toEqual({ kind: 'uncertain', reason: 'network' });
  });

  it('is registered in the registry when the NFS-e module starts', () => {
    const registry = new FiscalDocumentRegistry();
    new NfseExternalModule(registry, new FakeNfseProvider()).onModuleInit();
    expect(registry.get('nfse')).toBeInstanceOf(NfseGatewayAdapter);
  });
});
