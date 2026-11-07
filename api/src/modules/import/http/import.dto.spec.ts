import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListImportRowsQuery } from './import.dto';

const check = (raw: Record<string, unknown>) =>
  validate(plainToInstance(ListImportRowsQuery, raw));

describe('ListImportRowsQuery', () => {
  it('accepts a page of 1 to 200 rows, as text from the query string', async () => {
    expect(await check({ limit: '200' })).toHaveLength(0);
    expect(await check({ limit: '1', status: 'invalid' })).toHaveLength(0);
    expect(await check({})).toHaveLength(0);
  });

  it('refuses bigger pages, zero and unknown statuses', async () => {
    expect(await check({ limit: '201' })).not.toHaveLength(0);
    expect(await check({ limit: '0' })).not.toHaveLength(0);
    expect(await check({ status: 'nope' })).not.toHaveLength(0);
  });
});
