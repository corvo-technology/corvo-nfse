import { BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { createValidationPipe } from './validation-pipe';

class StrictDto {
  @IsString()
  name!: string;
}

class TolerantDto {
  static readonly allowUnknownProperties = true;

  @IsString()
  name!: string;
}

const meta = (metatype: new () => object) => ({
  type: 'body' as const,
  metatype,
});

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();

  it('rejects unknown fields by default', async () => {
    await expect(
      pipe.transform({ name: 'a', extra: 1 }, meta(StrictDto)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('drops unknown fields for DTOs that allow them', async () => {
    await expect(
      pipe.transform({ name: 'a', extra: 1 }, meta(TolerantDto)),
    ).resolves.toEqual({ name: 'a' });
  });

  it('still validates the known fields of a tolerant DTO', async () => {
    await expect(
      pipe.transform({ name: 1, extra: 1 }, meta(TolerantDto)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
