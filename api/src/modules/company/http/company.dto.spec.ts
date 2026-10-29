import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCompanyDto,
  UpdateCompanyDto,
  UpsertFiscalProfileDto,
} from './company.dto';

describe('specialRegime / specialTaxRegime (regEspTrib, E0174/E0175 scope)', () => {
  const createBody = (overrides: Record<string, unknown> = {}) => ({
    legalName: 'Empresa Teste LTDA',
    taxId: '12345678000195',
    municipalityCode: '3550308',
    taxRegime: 'Lucro Presumido',
    ...overrides,
  });

  const propertiesOf = (
    errors: Awaited<ReturnType<typeof validate>>,
  ): string[] => errors.map((error) => error.property);

  describe('CreateCompanyDto.specialRegime', () => {
    it.each(['0', '1', '2', '3', '4', '5', '6'])('accepts "%s"', async (v) => {
      const errors = await validate(
        plainToInstance(CreateCompanyDto, createBody({ specialRegime: v })),
      );
      expect(propertiesOf(errors)).not.toContain('specialRegime');
    });

    it('accepts an empty string (clears the field)', async () => {
      const errors = await validate(
        plainToInstance(CreateCompanyDto, createBody({ specialRegime: '' })),
      );
      expect(propertiesOf(errors)).not.toContain('specialRegime');
    });

    it('accepts omission', async () => {
      const errors = await validate(
        plainToInstance(CreateCompanyDto, createBody()),
      );
      expect(propertiesOf(errors)).not.toContain('specialRegime');
    });

    it.each(['7', 'abc', '9'])('rejects "%s"', async (v) => {
      const errors = await validate(
        plainToInstance(CreateCompanyDto, createBody({ specialRegime: v })),
      );
      expect(propertiesOf(errors)).toContain('specialRegime');
    });
  });

  describe('UpdateCompanyDto.specialRegime', () => {
    it.each(['0', '6'])('accepts "%s"', async (v) => {
      const errors = await validate(
        plainToInstance(UpdateCompanyDto, { specialRegime: v }),
      );
      expect(propertiesOf(errors)).not.toContain('specialRegime');
    });

    it('accepts an empty string (clears the field)', async () => {
      const errors = await validate(
        plainToInstance(UpdateCompanyDto, { specialRegime: '' }),
      );
      expect(propertiesOf(errors)).not.toContain('specialRegime');
    });

    it.each(['7', 'abc'])('rejects "%s"', async (v) => {
      const errors = await validate(
        plainToInstance(UpdateCompanyDto, { specialRegime: v }),
      );
      expect(propertiesOf(errors)).toContain('specialRegime');
    });
  });

  describe('UpsertFiscalProfileDto.specialTaxRegime', () => {
    const body = (overrides: Record<string, unknown> = {}) => ({
      taxRegime: 'LUCRO_PRESUMIDO',
      ...overrides,
    });

    it.each(['0', '1', '2', '3', '4', '5', '6'])('accepts "%s"', async (v) => {
      const errors = await validate(
        plainToInstance(UpsertFiscalProfileDto, body({ specialTaxRegime: v })),
      );
      expect(propertiesOf(errors)).not.toContain('specialTaxRegime');
    });

    it('accepts null', async () => {
      const errors = await validate(
        plainToInstance(
          UpsertFiscalProfileDto,
          body({ specialTaxRegime: null }),
        ),
      );
      expect(propertiesOf(errors)).not.toContain('specialTaxRegime');
    });

    it('accepts omission', async () => {
      const errors = await validate(
        plainToInstance(UpsertFiscalProfileDto, body()),
      );
      expect(propertiesOf(errors)).not.toContain('specialTaxRegime');
    });

    it.each(['7', 'abc', ''])('rejects "%s"', async (v) => {
      const errors = await validate(
        plainToInstance(UpsertFiscalProfileDto, body({ specialTaxRegime: v })),
      );
      expect(propertiesOf(errors)).toContain('specialTaxRegime');
    });
  });
});
