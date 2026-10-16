import type { ValidationError } from 'class-validator';

/** Flattens nested class-validator errors into "path: message" lines an agent can act on. */
export function describeValidationErrors(
  errors: ValidationError[],
  prefix = '',
): string[] {
  return errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map(
      (message) => `${path}: ${message}`,
    );
    return [...own, ...describeValidationErrors(error.children ?? [], path)];
  });
}

export function invalidInput(errors: ValidationError[]): Error {
  return new Error(
    `Invalid input: ${describeValidationErrors(errors).join('; ')}`,
  );
}
