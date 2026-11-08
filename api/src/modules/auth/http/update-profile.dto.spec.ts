import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

const check = (name: unknown) =>
  validate(plainToInstance(UpdateProfileDto, { name }));

describe('UpdateProfileDto', () => {
  it('accepts a normal name and tidies the spaces', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      name: '  Pedro   Henrique ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.name).toBe('Pedro Henrique');
  });

  it.each([
    ['', 'empty'],
    ['    ', 'blank'],
    [undefined, 'missing'],
    [42, 'not text'],
    ['x'.repeat(101), 'too long'],
  ])('rejects %s (%s)', async (value) => {
    expect((await check(value)).length).toBeGreaterThan(0);
  });
});
