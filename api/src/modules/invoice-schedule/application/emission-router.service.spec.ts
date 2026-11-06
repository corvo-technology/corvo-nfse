import { ScheduleValidationError } from '../domain/invoice-schedule';
import { EmissionRouterService } from './emission-router.service';

const TENANT = 't';
const auth = {} as never;
function build() {
  const invoice = { id: 'inv' };
  const schedule = { props: { id: 'sch' } };
  const invoices = { emit: jest.fn().mockResolvedValue(invoice) };
  const schedules = {
    createFromEmission: jest.fn().mockResolvedValue(schedule),
  };
  return {
    router: new EmissionRouterService(invoices as never, schedules as never),
    invoices,
    schedules,
    invoice,
    schedule,
  };
}
const dto = (options?: Record<string, unknown>) =>
  ({ amount: 10, competenceDate: '2026-11-09', options }) as never;

describe('EmissionRouterService', () => {
  it.each([
    [undefined],
    [{}],
    [{ type: 'IMMEDIATE' }],
    [{ email: { send: true } }],
  ])('issues a note as always for %j', async (options) => {
    const { router, invoices, schedules, invoice } = build();
    const out = await router.emit(dto(options), TENANT, auth, 'key-1');
    expect(out).toEqual({ kind: 'invoice', invoice });
    expect(invoices.emit).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      auth,
      'key-1',
    );
    expect(schedules.createFromEmission).not.toHaveBeenCalled();
  });

  it.each(['SCHEDULE', 'RECURRING'])(
    '%s creates a schedule and issues nothing',
    async (type) => {
      const { router, invoices, schedules, schedule } = build();
      const request = dto({ type, recurrence: { frequency: 'WEEKLY' } });
      const out = await router.emit(request, TENANT, auth, 'key-9');
      expect(out).toEqual({ kind: 'schedule', schedule });
      expect(schedules.createFromEmission).toHaveBeenCalledWith(
        request,
        TENANT,
        auth,
        undefined,
        'key-9',
      );
      expect(invoices.emit).not.toHaveBeenCalled();
    },
  );

  it('refuses a recurrence on an immediate emission', async () => {
    const { router, invoices } = build();
    await expect(
      router.emit(
        dto({ type: 'IMMEDIATE', recurrence: { frequency: 'WEEKLY' } }),
        TENANT,
        auth,
      ),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
    expect(invoices.emit).not.toHaveBeenCalled();
  });
});
