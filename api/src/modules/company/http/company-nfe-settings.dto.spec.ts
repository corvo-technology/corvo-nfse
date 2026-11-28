import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCompanyNfeSettingsDto } from './company-nfe-settings.dto';

const errorsOf = async (body: Record<string, unknown>) =>
  (
    await validate(
      plainToInstance(UpdateCompanyNfeSettingsDto, {
        stateRegistration: '110042490114',
        ...body,
      }),
    )
  ).map((error) => error.property);

describe('UpdateCompanyNfeSettingsDto series', () => {
  it('accepts the NFC-e series from 0 to 999', async () => {
    expect(await errorsOf({ nfceDefaultSeries: 0 })).toEqual([]);
    expect(await errorsOf({ nfceDefaultSeries: 999 })).toEqual([]);
    expect(await errorsOf({})).toEqual([]);
  });

  it('refuses 1000 and a fraction', async () => {
    expect(await errorsOf({ nfceDefaultSeries: 1000 })).toEqual([
      'nfceDefaultSeries',
    ]);
    expect(await errorsOf({ nfceDefaultSeries: 1.5 })).toEqual([
      'nfceDefaultSeries',
    ]);
  });
});

describe('UpdateCompanyNfeSettingsDto nfceAutoOffline', () => {
  it('accepts a boolean and refuses anything else', async () => {
    expect(await errorsOf({ nfceAutoOffline: true })).toEqual([]);
    expect(await errorsOf({ nfceAutoOffline: 'yes' })).toEqual([
      'nfceAutoOffline',
    ]);
  });
});

describe('UpdateCompanyNfeSettingsDto stateRegistration', () => {
  it('may be left out (the SEFAZ cadastro fills it)', async () => {
    const dto = plainToInstance(UpdateCompanyNfeSettingsDto, {});
    expect((await validate(dto)).map((e) => e.property)).toEqual([]);
  });

  it('still refuses a too short IE', async () => {
    expect(await errorsOf({ stateRegistration: '123' })).toEqual([
      'stateRegistration',
    ]);
  });
});
