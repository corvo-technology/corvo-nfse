import type { FiscalError } from '@/modules/invoice/domain/fiscal/fiscal-error';
import type { DecimalString } from '@/modules/invoice/domain/fiscal/money';
import type { Result } from '@/modules/invoice/domain/fiscal/result';
import type { RtcCalculationInput } from '@/modules/invoice/domain/fiscal/rtc/rtc-calculator.port';
import type { RtcTaxResult } from '@/modules/invoice/domain/fiscal/rtc/rtc-tax-result';

/**
 * Mapa do contrato verificado da Calculadora RTC (`docs/fiscal/rtc/`):
 * transforma o input de domínio nos corpos oficiais e devolve o resultado
 * tipado — ou o FiscalError quando o corpo viola o contrato. Implementado por
 * `DefaultRtcMapper` (fixtures reais) e por fakes nos testes do adapter.
 */
export interface RtcMapper {
  /** Base da NFS-e (2026: deduz ISS do valor; nunca PIS/COFINS). */
  toBaseRequest(input: RtcCalculationInput): {
    path: '/calculadora/nfse/base-calculo';
    body: unknown;
  };

  fromBaseResponse(body: unknown): Result<DecimalString, FiscalError>;

  /** Cálculo do regime-geral (nunca aliquotasNominais). */
  toCalcRequest(
    input: RtcCalculationInput,
    baseCalculo: DecimalString,
  ): { path: '/calculadora/regime-geral'; body: unknown };

  fromCalcResponse(
    body: unknown,
    input: RtcCalculationInput,
    calculatorVersion: string,
  ): Result<RtcTaxResult, FiscalError>;

  /** Classifica um problem+json de 4xx; null quando o tipo é desconhecido. */
  fromProblem(status: number, body: unknown): FiscalError | null;
}
