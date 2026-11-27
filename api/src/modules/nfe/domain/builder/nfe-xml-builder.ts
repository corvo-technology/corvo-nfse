import Builder from 'fast-xml-builder';
import type { TpEmis } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { BuiltDocument } from '@/modules/fiscal-core/application/emission-pipeline';
import { nfceQrCodeOnline } from '@/modules/nfce/domain/nfce-qr-code';
import { buildAccessKey } from '../access-key';
import type { NfeDraft } from '../nfe-draft';
import {
  NFE_NAMESPACE,
  type BuildContext,
  type NfeContingency,
  type NfeRespTec,
  type XmlNode,
} from './context';
import { destGroup } from './dest.group';
import { detGroup } from './det.group';
import { emitGroup } from './emit.group';
import { ibsCbsGroup } from './ibs-cbs.group';
import { ideGroup } from './ide.group';
import { infAdicGroup } from './inf-adic.group';
import { infRespTecGroup } from './inf-resp-tec.group';
import { pagGroup } from './pag.group';
import { totalGroup } from './total.group';
import { transpGroup } from './transp.group';

/** `infNFeSupl` of the NFC-e: the QR Code base and the consultation URL of the UF. */
export type NfeSupplement = {
  urlChave: string;
} & (
  | {
      /** Online (`tpEmis` 1): the QR Code is `<base>?p=<key>|3|<tpAmb>`. */
      qrCodeBase: string;
      qrCodeOf?: undefined;
    }
  | {
      /** Off-line (`tpEmis` 9): the caller builds and signs the QR Code once the key is known. */
      qrCodeOf: (accessKey: string) => string;
      qrCodeBase?: undefined;
    }
);

interface BuilderState {
  draft: NfeDraft;
  supplement: NfeSupplement | null;
  series?: number;
  number?: number;
  cNF?: string;
  dhEmi?: string;
  tpAmb?: 1 | 2;
  verProc: string;
  respTec: NfeRespTec | null;
  contingency: NfeContingency | null;
}

const xml = new Builder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  suppressEmptyNode: false,
  format: false,
});

/**
 * Immutable, fluent builder of the NF-e 4.00 XML (`<NFe>` without its signature). Every group is a
 * pure function in its own file. The XML is serialized without a prolog and without whitespace
 * between elements, so the signature digest is stable.
 */
export class NfeXmlBuilder {
  private constructor(private readonly state: BuilderState) {}

  static for(draft: NfeDraft): NfeXmlBuilder {
    return new NfeXmlBuilder({
      draft,
      verProc: 'Corvo',
      respTec: null,
      supplement: null,
      contingency: null,
    });
  }

  withNumber(series: number, number: number): NfeXmlBuilder {
    return new NfeXmlBuilder({ ...this.state, series, number });
  }

  withCnf(cNF: string): NfeXmlBuilder {
    return new NfeXmlBuilder({ ...this.state, cNF });
  }

  /** `dhEmi` with the offset of the issuer's UF (see `dhEmiFor`). */
  withIssuedAt(dhEmi: string): NfeXmlBuilder {
    return new NfeXmlBuilder({ ...this.state, dhEmi });
  }

  /** Defaults to 2 (homologation) for a test company and 1 for a live one. */
  withTpAmb(tpAmb: 1 | 2): NfeXmlBuilder {
    return new NfeXmlBuilder({ ...this.state, tpAmb });
  }

  withVerProc(verProc: string): NfeXmlBuilder {
    return new NfeXmlBuilder({ ...this.state, verProc });
  }

  withRespTec(respTec: NfeRespTec | null): NfeXmlBuilder {
    return new NfeXmlBuilder({ ...this.state, respTec });
  }

  /** Required for model 65; ignored (and refused) for model 55. */
  withSupplement(supplement: NfeSupplement | null): NfeXmlBuilder {
    return new NfeXmlBuilder({ ...this.state, supplement });
  }

  /**
   * `tpEmis` 6, 7 or 9 with `dhCont` and `xJust` (15 to 256 characters). `null` (the default) is a
   * normal emission, `tpEmis` 1.
   */
  withContingency(contingency: NfeContingency | null): NfeXmlBuilder {
    if (contingency && !/^.{15,256}$/s.test(contingency.xJust.trim()))
      throw new Error('NfeXmlBuilder: xJust must have 15 to 256 characters');
    return new NfeXmlBuilder({
      ...this.state,
      contingency: contingency
        ? { ...contingency, xJust: contingency.xJust.trim() }
        : null,
    });
  }

  build(): BuiltDocument {
    const { draft, series, number, cNF, dhEmi } = this.state;
    if (series === undefined || number === undefined)
      throw new Error('NfeXmlBuilder: withNumber() is required');
    if (!cNF) throw new Error('NfeXmlBuilder: withCnf() is required');
    if (!dhEmi) throw new Error('NfeXmlBuilder: withIssuedAt() is required');
    const { supplement } = this.state;
    if (draft.model === 65 && !supplement)
      throw new Error(
        'NfeXmlBuilder: withSupplement() is required for model 65',
      );
    if (draft.model === 55 && supplement)
      throw new Error('NfeXmlBuilder: withSupplement() is only for model 65');
    const cUF = draft.issuer.cUF;
    const { contingency } = this.state;
    const tpEmis: TpEmis = contingency?.tpEmis ?? 1;
    const tpAmb = this.state.tpAmb ?? (draft.environment === 'live' ? 1 : 2);
    const accessKey = buildAccessKey({
      cUF,
      issuedAt: dhEmi,
      cnpj: draft.issuer.cnpj,
      model: draft.model,
      series,
      number,
      tpEmis,
      cNF,
    });
    const ctx: BuildContext = {
      draft,
      cUF,
      series,
      number,
      cNF,
      dhEmi,
      tpAmb,
      accessKey,
      verProc: this.state.verProc,
      respTec: this.state.respTec,
      tpEmis,
      contingency,
    };
    const infNFe: XmlNode = {
      '@_versao': '4.00',
      '@_Id': `NFe${accessKey}`,
      ide: ideGroup(ctx),
      emit: emitGroup(ctx),
      dest: destGroup(ctx),
      det: detGroup(ctx),
      total: totalGroup(ctx),
      transp: transpGroup(ctx),
      pag: pagGroup(ctx),
      infAdic: infAdicGroup(ctx),
      infRespTec: infRespTecGroup(ctx),
    };
    // IBS/CBS sits on the items and on the total in the layout; it will be added here when required.
    ibsCbsGroup(ctx);
    const qrCode = supplement
      ? supplement.qrCodeOf
        ? supplement.qrCodeOf(accessKey)
        : nfceQrCodeOnline(supplement.qrCodeBase, accessKey, tpAmb)
      : undefined;
    // `infNFeSupl` is a sibling right after `infNFe`; the signature is appended after it.
    const document = {
      NFe: {
        '@_xmlns': NFE_NAMESPACE,
        infNFe,
        infNFeSupl:
          supplement && qrCode
            ? { qrCode, urlChave: supplement.urlChave }
            : undefined,
      },
    };
    return {
      accessKey,
      ...(supplement && qrCode
        ? { qrCode, urlChave: supplement.urlChave }
        : {}),
      xml: String(xml.build(stripUndefined(document))),
      referenceTag: 'infNFe',
    };
  }
}

/** Drops `undefined` keys, recursively, so optional groups leave no trace in the XML. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    ) as T;
  return value;
}
