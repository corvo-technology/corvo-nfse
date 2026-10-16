/** Estados do disjuntor: fechado (operando), aberto (rejeitando) e meio-aberto (testando a volta). */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Disjuntor em memória por processo para a Calculadora RTC: após N falhas
 * consecutivas rejeita as chamadas sem tocar a rede até resetMs se passar,
 * quando permite uma única sonda — sucesso fecha, falha reabre. Sem
 * dependências externas de propósito: o adapter já é a fronteira de rede.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpenProbeInFlight = false;
  private currentState: CircuitState = 'closed';

  constructor(
    private readonly options: {
      failureThreshold: number;
      resetMs: number;
      now?: () => number;
    },
  ) {}

  get state(): CircuitState {
    return this.currentState;
  }

  canPass(): boolean {
    switch (this.currentState) {
      case 'closed':
        return true;
      case 'open':
        if (this.now() - this.openedAt >= this.options.resetMs) {
          this.currentState = 'half-open';
          this.halfOpenProbeInFlight = true;
          return true;
        }
        return false;
      case 'half-open':
        if (this.halfOpenProbeInFlight) return false;
        this.halfOpenProbeInFlight = true;
        return true;
    }
  }

  onSuccess(): void {
    this.failures = 0;
    this.halfOpenProbeInFlight = false;
    this.currentState = 'closed';
  }

  onFailure(): void {
    this.failures += 1;
    this.halfOpenProbeInFlight = false;
    if (this.currentState === 'half-open') {
      this.reopen();
      return;
    }
    if (this.failures >= this.options.failureThreshold) this.reopen();
  }

  private reopen(): void {
    this.currentState = 'open';
    this.openedAt = this.now();
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
}
