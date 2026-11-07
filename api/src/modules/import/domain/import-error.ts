export type ImportErrorCode =
  | 'ERROR_IMPORT_EMPTY'
  | 'ERROR_IMPORT_TOO_MANY_ROWS'
  | 'ERROR_IMPORT_UNREADABLE';

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
