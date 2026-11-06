import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { ScheduleCron } from './schedule.cron';

describe('ScheduleCron', () => {
  it('runs at 09:00 São Paulo, Monday to Friday, without overlapping itself', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      ScheduleCron.prototype.run,
    ) as Record<string, unknown>;
    expect(options).toMatchObject({
      cronTime: '0 9 * * 1-5',
      timeZone: 'America/Sao_Paulo',
      waitForCompletion: true,
    });
  });

  it('runs the due schedules for today in São Paulo', async () => {
    const runDue = jest.fn().mockResolvedValue({
      issued: 1,
      failed: 0,
      paused: 0,
      errors: 0,
    });
    await new ScheduleCron({ runDue } as never).run();
    expect(runDue).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('never throws, so a failing run cannot take the scheduler down', async () => {
    const runDue = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      new ScheduleCron({ runDue } as never).run(),
    ).resolves.toBeUndefined();
  });
});
