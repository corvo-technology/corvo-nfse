import { Test } from '@nestjs/testing';
import { AppConfigModule } from '@/infra/config/config.module';
import { SecurityModule } from './security.module';

describe('SecurityModule', () => {
  it('composes with the OTP module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, SecurityModule],
    }).compile();

    await moduleRef.close();
  });
});
