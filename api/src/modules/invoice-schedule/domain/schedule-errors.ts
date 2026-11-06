export class ScheduleNotFoundError extends Error {
  constructor() {
    super('Schedule not found');
    this.name = 'ScheduleNotFoundError';
  }
}

export class ScheduleLimitError extends Error {
  constructor(readonly max: number) {
    super(`A workspace can have at most ${max} active schedules`);
    this.name = 'ScheduleLimitError';
  }
}
