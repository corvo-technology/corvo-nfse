import type { NfceInput } from '../domain/nfce-input';
import {
  NfceOfflineService,
  OFFLINE_REASON_AUTHORITY_DOWN,
  OFFLINE_REASON_NO_CONNECTION,
  OFFLINE_REASON_REQUESTED,
} from './nfce-offline.service';

type Situation = {
  breakerOpen: boolean;
  authorityReachable: boolean | null;
  network: 'ok' | 'gov_unreachable_from_us' | 'no_internet';
};

const company = {
  id: 'c1',
  taxId: '12345678000195',
  legalName: 'Empresa Teste LTDA',
  tradeName: null,
  addressState: 'SP',
  addressCity: 'São Paulo',
  addressStreet: 'Avenida Paulista',
  addressNumber: '1000',
  addressDistrict: 'Bela Vista',
  addressZip: '01310100',
  municipalityCode: '3550308',
};

const settings = (nfceAutoOffline: boolean) => ({
  companyId: 'c1',
  stateRegistration: '110042490114',
  crt: 1,
  nfceAutoOffline,
});

const input = (extra: Partial<NfceInput> = {}) =>
  ({ companyId: 'c1', ...extra }) as NfceInput;

function build(stored: unknown, situation: Situation) {
  const situationReader = { situation: jest.fn().mockResolvedValue(situation) };
  const service = new NfceOfflineService(
    {} as never,
    {} as never,
    {
      tpAmb: () => 2,
      breakerAuthority: () => 'nfce-sp-2',
    } as never,
    {} as never,
    { findById: jest.fn().mockResolvedValue(company) } as never,
    { find: jest.fn().mockResolvedValue(stored) } as never,
    situationReader,
    {} as never,
  );
  return { service, situationReader };
}

const down: Situation = {
  breakerOpen: true,
  authorityReachable: false,
  network: 'ok',
};
const noNetwork: Situation = {
  breakerOpen: false,
  authorityReachable: null,
  network: 'gov_unreachable_from_us',
};
const normal: Situation = {
  breakerOpen: false,
  authorityReachable: true,
  network: 'ok',
};

describe('NfceOfflineService.reasonFor (the contingency is always on)', () => {
  it('a request for off-line always counts', async () => {
    const { service } = build(settings(false), normal);
    await expect(
      service.reasonFor('t1', 'test', input({ contingency: 'offline' })),
    ).resolves.toBe(OFFLINE_REASON_REQUESTED);
  });

  it('goes off-line with the authority down even when the old option is off', async () => {
    const { service } = build(settings(false), down);
    await expect(service.reasonFor('t1', 'test', input())).resolves.toBe(
      OFFLINE_REASON_AUTHORITY_DOWN,
    );
  });

  it('goes off-line when our way to the SEFAZ is down, with the old option on or off', async () => {
    for (const flag of [true, false]) {
      const { service } = build(settings(flag), noNetwork);
      await expect(service.reasonFor('t1', 'test', input())).resolves.toBe(
        OFFLINE_REASON_NO_CONNECTION,
      );
    }
  });

  it('takes the normal way when everything works', async () => {
    const { service } = build(settings(false), normal);
    await expect(service.reasonFor('t1', 'test', input())).resolves.toBeNull();
  });

  it('takes the normal way when the company has no NF-e settings yet', async () => {
    const { service, situationReader } = build(null, down);
    await expect(service.reasonFor('t1', 'test', input())).resolves.toBeNull();
    expect(situationReader.situation).not.toHaveBeenCalled();
  });
});
