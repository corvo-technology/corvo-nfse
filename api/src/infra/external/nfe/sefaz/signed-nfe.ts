import type {
  Authorization,
  ConsultResult,
} from '@/modules/fiscal-core/domain/ports/gateway.port';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';

/** Document type `D` of every NF-e gateway: the signed XML, its key and the issuer's UF. */
export interface SignedNfe {
  accessKey: string;
  signedXml: string;
  uf: Uf;
}

/** An authorization with what the NF-e needs beyond the generic port. */
export interface NfeAuthorization extends Authorization {
  protocol: string;
  authorizedAt: Date;
  cStat: string;
  xMotivo: string;
  /** `<protNFe>` as returned by the SEFAZ; PR6 joins it with the NFe into the nfeProc. */
  protNFeXml: string;
}

export interface NfeEventRecord {
  tpEvento: string;
  nSeq: number;
  protocol: string;
  procEventoXml: string;
}

/** Consultation by key: the generic status plus the NF-e specifics (events registered). */
export interface NfeConsultResult extends ConsultResult {
  cStat: string;
  xMotivo: string;
  authorization?: NfeAuthorization;
  events: NfeEventRecord[];
}
