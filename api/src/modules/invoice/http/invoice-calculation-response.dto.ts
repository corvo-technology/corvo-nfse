import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { InvoiceCalculationResponse } from '../application/fiscal/calculation-response';

class TaxAmountDto {
  @ApiProperty({ example: '1000.00' }) declare base: string;
  @ApiProperty({ example: '3.00' }) declare rate: string;
  @ApiProperty({ example: '30.00' }) declare amount: string;
}
class WithholdingAmountDto extends TaxAmountDto {
  @ApiProperty({ enum: ['ISS', 'IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS'] })
  declare tax: string;
}
class CalculatedTaxesDto {
  @ApiPropertyOptional({ type: TaxAmountDto }) declare iss?: TaxAmountDto;
  @ApiPropertyOptional({ type: TaxAmountDto }) declare cbs?: TaxAmountDto;
  @ApiPropertyOptional({ type: TaxAmountDto }) declare ibsState?: TaxAmountDto;
  @ApiPropertyOptional({ type: TaxAmountDto }) declare ibsCity?: TaxAmountDto;
  @ApiPropertyOptional({ type: TaxAmountDto }) declare ibsTotal?: TaxAmountDto;
}
class ObligationDto {
  @ApiProperty({
    enum: [
      'REQUIRED',
      'NOT_APPLICABLE',
      'UNSUPPORTED',
      'MISSING_CONFIGURATION',
    ],
  })
  declare status: string;
  @ApiPropertyOptional() declare reason?: string;
  @ApiPropertyOptional({ type: [String] }) declare missingFields?: string[];
}
class ApplicabilityDto {
  @ApiProperty() declare strategy: string;
  @ApiProperty() declare customerRequired: boolean;
  @ApiProperty({ type: ObligationDto }) declare iss: ObligationDto;
  @ApiProperty({ type: ObligationDto }) declare issWithheld: ObligationDto;
  @ApiProperty({ type: ObligationDto })
  declare federalWithholding: ObligationDto;
  @ApiProperty({ type: ObligationDto }) declare cbs: ObligationDto;
  @ApiProperty({ type: ObligationDto }) declare ibs: ObligationDto;
  @ApiProperty({ type: ObligationDto }) declare specialTreatment: ObligationDto;
  @ApiProperty() declare collectionWaived: boolean;
  @ApiProperty() declare rulesVersion: string;
  @ApiProperty({ type: [String] }) declare legalReferences: string[];
}
class ClassificationDto {
  @ApiProperty() declare serviceCode: string;
  @ApiProperty({ type: String, nullable: true }) declare municipalServiceCode:
    string | null;
  @ApiProperty({ type: String, nullable: true }) declare nbsCode: string | null;
  @ApiProperty({ type: String, nullable: true }) declare cst: string | null;
  @ApiProperty({ type: String, nullable: true }) declare classCode:
    string | null;
  @ApiProperty({ type: String, nullable: true }) declare operationIndicator:
    string | null;
  @ApiProperty({
    enum: ['company_service_profile', 'request_override', 'official_catalog'],
  })
  declare source: string;
  @ApiProperty({ type: String, nullable: true }) declare serviceProfileId:
    string | null;
  @ApiProperty() declare operationNature: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  declare iss: object;
  @ApiProperty({ type: 'object', additionalProperties: true })
  declare withholding: object;
  @ApiProperty() declare catalogValidated: boolean;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  declare catalogVersions: Record<string, string>;
  @ApiProperty() declare justification: string;
}
class CalculationMetadataDto {
  @ApiProperty({ enum: ['none', 'legacy', 'rtc', 'legacy+rtc'] })
  declare source: string;
  @ApiProperty({ type: String, nullable: true }) declare calculatorVersion:
    string | null;
  @ApiProperty({ type: String, nullable: true }) declare rulesVersion:
    string | null;
  @ApiProperty({ type: [String] }) declare legalReferences: string[];
}
class FiscalWarningDto {
  @ApiProperty() declare code: string;
  @ApiProperty() declare message: string;
  @ApiProperty() declare step: string;
}
class BlockingDto extends FiscalWarningDto {
  @ApiProperty({
    enum: [
      'VALIDATION',
      'CONFIGURATION',
      'CLASSIFICATION',
      'UNSUPPORTED',
      'CALCULATION',
      'INTEGRATION',
      'INTERNAL',
    ],
  })
  declare category: string;
  @ApiProperty() declare retryable: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true })
  declare details: Record<string, unknown>;
}
class PendingFieldDto {
  @ApiProperty() declare field: string;
  @ApiProperty() declare reason: string;
}
class CalculationTraceDto {
  @ApiProperty() declare step: string;
  @ApiProperty({ enum: ['applied', 'skipped', 'failed'] })
  declare status: string;
  @ApiProperty({ minimum: 0, description: 'Duration in milliseconds' })
  declare durationMs: number;
  @ApiPropertyOptional() declare reason?: string;
}
export class InvoiceCalculationResponseDto implements InvoiceCalculationResponse {
  @ApiProperty({ enum: [true] }) declare preEmission: true;
  @ApiProperty({ enum: ['ready', 'blocked'] })
  declare status: InvoiceCalculationResponse['status'];
  @ApiProperty() declare disclaimer: string;
  @ApiProperty({ format: 'date' }) declare competenceDate: string;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: [
      'MEI',
      'SIMPLES_NACIONAL',
      'LUCRO_PRESUMIDO',
      'LUCRO_REAL',
      'OUTRO_REGIME',
      'UNKNOWN',
    ],
  })
  declare taxRegime: InvoiceCalculationResponse['taxRegime'];
  @ApiProperty({ type: ClassificationDto, nullable: true })
  declare classification: InvoiceCalculationResponse['classification'];
  @ApiProperty({ type: ApplicabilityDto, nullable: true })
  declare applicability: InvoiceCalculationResponse['applicability'];
  @ApiProperty({ type: CalculatedTaxesDto })
  declare taxes: InvoiceCalculationResponse['taxes'];
  @ApiProperty({ type: [WithholdingAmountDto] })
  declare withholdings: InvoiceCalculationResponse['withholdings'];
  @ApiProperty({ type: String, nullable: true, example: '1000.00' })
  declare netReceivableAmount: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare collectionWaived:
    boolean | null;
  @ApiProperty({ type: CalculationMetadataDto, nullable: true })
  declare calculation: InvoiceCalculationResponse['calculation'];
  @ApiProperty({ type: [FiscalWarningDto] })
  declare warnings: InvoiceCalculationResponse['warnings'];
  @ApiProperty({ type: [PendingFieldDto] })
  declare pendingFields: InvoiceCalculationResponse['pendingFields'];
  @ApiProperty({ type: BlockingDto, nullable: true })
  declare blocking: InvoiceCalculationResponse['blocking'];
  @ApiProperty({ type: [CalculationTraceDto] })
  declare trace: InvoiceCalculationResponse['trace'];
}
