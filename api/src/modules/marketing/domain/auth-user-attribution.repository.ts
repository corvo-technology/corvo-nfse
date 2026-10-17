export abstract class IAuthUserAttributionRepository {
  /** Atomically records the attribution once; a second call for the same user is a no-op. */
  abstract recordIfAbsent(
    authUserId: string,
    attribution: Record<string, unknown>,
  ): Promise<boolean>;
}
