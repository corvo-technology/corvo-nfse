/** Test-only stand-in for @nestjs/common, so web tests can import API services whose deps live in api/. */
export const Injectable = () => (_target: unknown, _context?: unknown): void => undefined;
