import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlatformUsersQuery } from './platform-users-query.dto';

describe('PlatformUsersQuery', () => {
  it('rejeita search com 101 caracteres', async () => {
    const dto = plainToInstance(PlatformUsersQuery, {
      search: 'a'.repeat(101),
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
  it('aceita 100 e apara espaços', async () => {
    const dto = plainToInstance(PlatformUsersQuery, {
      search: `  ${'a'.repeat(100)}  `,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.search).toBe('a'.repeat(100));
  });
  it('search em branco vira undefined', () => {
    expect(
      plainToInstance(PlatformUsersQuery, { search: '   ' }).search,
    ).toBeUndefined();
  });
});
