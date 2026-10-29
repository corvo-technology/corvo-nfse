import {
  CANCELLATION_DESCRIPTION_MAX,
  CANCELLATION_DESCRIPTION_MIN,
  assertFiscalCancellationReason,
  cancellationReason,
} from './cancellation-reason';
import { InvalidCancellationReasonError } from './errors';

const reasonOf = (length: number) =>
  cancellationReason('other', 'x'.repeat(length));

describe('cancellation description rule', () => {
  it('exposes the single-source bounds', () => {
    expect(CANCELLATION_DESCRIPTION_MIN).toBe(15);
    expect(CANCELLATION_DESCRIPTION_MAX).toBe(255);
  });

  it.each([14, 256])('rejects %i characters', (length) => {
    expect(() => assertFiscalCancellationReason(reasonOf(length))).toThrow(
      InvalidCancellationReasonError,
    );
  });

  it.each([15, 255])('accepts %i characters', (length) => {
    expect(() =>
      assertFiscalCancellationReason(reasonOf(length)),
    ).not.toThrow();
  });
});
