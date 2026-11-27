import type { NfeStatus } from './nfe-status';

export class InvalidNfeTransitionError extends Error {
  constructor(from: NfeStatus, to: NfeStatus) {
    super(`Invalid NF-e transition from '${from}' to '${to}'`);
    this.name = 'InvalidNfeTransitionError';
  }
}

export class NfeNumberAlreadyAssignedError extends Error {
  constructor() {
    super('The NF-e already has a number; a number is assigned only once');
    this.name = 'NfeNumberAlreadyAssignedError';
  }
}

export class NfeNumberingExhaustedError extends Error {
  constructor() {
    super('The series reached the last NF-e number (999999999)');
    this.name = 'NfeNumberingExhaustedError';
  }
}
