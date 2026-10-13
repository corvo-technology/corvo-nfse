import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { InviteProfessionalDto } from './auth.dto';

describe('InviteProfessionalDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const payload = {
    name: 'Pedro Henrique',
    email: 'pedro@example.com',
    phone: '(61) 99813-1223',
  };

  it.each([true, false])(
    'accepts isAvailableForBooking=%s',
    async (isAvailableForBooking) => {
      const result = await pipe.transform(
        { ...payload, isAvailableForBooking },
        { type: 'body', metatype: InviteProfessionalDto },
      );

      expect(result).toEqual(
        expect.objectContaining({ isAvailableForBooking }),
      );
    },
  );

  it('rejects non-boolean isAvailableForBooking values', async () => {
    await expect(
      pipe.transform(
        { ...payload, isAvailableForBooking: 'true' },
        { type: 'body', metatype: InviteProfessionalDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
