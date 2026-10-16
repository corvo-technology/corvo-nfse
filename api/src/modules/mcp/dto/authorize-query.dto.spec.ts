import { createValidationPipe } from '@/shared/http/validation-pipe';
import { AuthorizeQueryDto } from './authorize-query.dto';

const query = {
  response_type: 'code',
  client_id: 'corvo-mcp-4lR111-7pZGM_a-4qCKDC',
  code_challenge: 'ja4MYa-xsYMgjBwy5y1IDQP-RVvMYFNwI4LJwh73utQ',
  code_challenge_method: 'S256',
  redirect_uri: 'http://localhost:59446/callback',
  state: 'GQxKNDlA46sBrb4as1OVPgO2J-qdnC0KAJ0eFgQVA6A',
  scope: 'nfse:read nfse:write',
};

describe('AuthorizeQueryDto', () => {
  const pipe = createValidationPipe();
  const meta = { type: 'query' as const, metatype: AuthorizeQueryDto };

  it('accepts the RFC 8707 resource parameter sent by Claude Code', async () => {
    const result = (await pipe.transform(
      { ...query, resource: 'https://api.corvo.tech/mcp' },
      meta,
    )) as AuthorizeQueryDto;
    expect(result.resource).toBe('https://api.corvo.tech/mcp');
  });

  it('ignores unknown parameters', async () => {
    const result = await pipe.transform({ ...query, vendor_extra: 'x' }, meta);
    expect(result).not.toHaveProperty('vendor_extra');
  });

  it('still requires the PKCE challenge', async () => {
    const { code_challenge: _omitted, ...withoutChallenge } = query;
    await expect(pipe.transform(withoutChallenge, meta)).rejects.toBeDefined();
  });
});
