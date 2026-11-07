export type ImportErrorCode =
  | 'ERROR_IMPORT_EMPTY'
  | 'ERROR_IMPORT_TOO_MANY_ROWS'
  | 'ERROR_IMPORT_UNREADABLE'
  | 'ERROR_IMPORT_COMPANY_NOT_FOUND';

/** A whole-file problem. Row problems never throw: they become an invalid row. */
export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export class ImportNotFoundError extends Error {
  constructor() {
    super('Import not found');
    this.name = 'ImportNotFoundError';
  }
}

/** The import is not in a state that allows the action (editing after emitting, emitting twice, ...). */
export class ImportStateError extends Error {
  constructor(message = 'The import is not in a state that allows this') {
    super(message);
    this.name = 'ImportStateError';
  }
}

export class ImportFileInvalidError extends Error {
  constructor() {
    super('Send a .csv or .xlsx file');
    this.name = 'ImportFileInvalidError';
  }
}

export class ImportFileTooLargeError extends Error {
  constructor() {
    super('The file is larger than 10 MB');
    this.name = 'ImportFileTooLargeError';
  }
}
