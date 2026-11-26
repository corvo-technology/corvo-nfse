import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { GatewayOutcome } from '../domain/gateway-outcome';
import type {
  Authorization,
  FiscalDocumentGateway,
  SigningContext,
} from '../domain/ports/gateway.port';
import type {
  CompanyFiscalSnapshot,
  ValidationIssue,
} from '../domain/ports/tax-validator.port';
import type { LoadedCertificate, XmlSigner } from '../domain/ports/xml.port';

export interface ValidationContext {
  environment: ExecutionEnvironment;
  profile?: CompanyFiscalSnapshot;
}

/** Chain of Responsibility link: the pipeline runs every validator and joins all the issues. */
export interface PreSendValidator<D> {
  readonly name: string;
  validate(
    doc: D,
    ctx: ValidationContext,
  ): Promise<ValidationIssue[]> | ValidationIssue[];
}

export interface BuiltDocument {
  accessKey: string;
  xml: string;
  referenceTag: 'infNFe';
}

export type SignedDocument = BuiltDocument & { signedXml: string };

export interface EmissionSteps<D> {
  validators: PreSendValidator<D>[];
  build(doc: D, n: { series: number; number: number }): BuiltDocument;
  /** Write-ahead: number, key and signed XML are stored before anything is sent. */
  persistBeforeSend(doc: D, built: SignedDocument): Promise<void>;
  onAuthorized(doc: D, auth: Authorization): Promise<void>;
}

export interface PrepareContext extends ValidationContext {
  certificate: LoadedCertificate;
}

export async function runValidators<D>(
  validators: PreSendValidator<D>[],
  doc: D,
  ctx: ValidationContext,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const validator of validators)
    issues.push(...(await validator.validate(doc, ctx)));
  return issues;
}

/**
 * Template Method for emission: validate, build, sign, persist (prepare), then send. It opens no
 * transaction; the caller decides where the write-ahead commit happens.
 */
export class EmissionPipeline<D> {
  constructor(
    private readonly steps: EmissionSteps<D>,
    private readonly signer: XmlSigner,
  ) {}

  async prepare(
    doc: D,
    n: { series: number; number: number },
    ctx: PrepareContext,
  ): Promise<
    | { ok: true; signed: SignedDocument }
    | { ok: false; issues: ValidationIssue[] }
  > {
    const issues = await runValidators(this.steps.validators, doc, ctx);
    if (issues.length > 0) return { ok: false, issues };
    const built = this.steps.build(doc, n);
    const signedXml = this.signer.sign(
      built.xml,
      built.referenceTag,
      ctx.certificate,
    );
    const signed: SignedDocument = { ...built, signedXml };
    await this.steps.persistBeforeSend(doc, signed);
    return { ok: true, signed };
  }

  async send(
    doc: D,
    _signed: SignedDocument,
    gateway: FiscalDocumentGateway<D>,
    ctx: SigningContext,
  ): Promise<GatewayOutcome<Authorization>> {
    const outcome = await gateway.issuer.issue(doc, ctx);
    if (outcome.kind === 'ok')
      await this.steps.onAuthorized(doc, outcome.value);
    return outcome;
  }
}
