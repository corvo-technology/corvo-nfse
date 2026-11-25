import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A real authorized NFS-e (CNPJ 61469487000140, DPS 1/2, R$ 49,90, competence 16/10/2026). */
export const REAL_NFSE_XML = readFileSync(
  join(__dirname, '../../../infra/danfse/__fixtures__/authorized-nfse.xml'),
  'utf8',
);

/** The real NFS-e rewritten to say what a test invoice says, for the portal-note check. */
export function portalNfseXml(note: {
  providerCnpj: string;
  customerCpf?: string | null;
  customerCnpj?: string | null;
  amount: string;
  competenceDate: string;
  series: string;
  number: number;
  /** 1 = Produção (default, what a live invoice gets), 2 = Produção Restrita. */
  tpAmb?: '1' | '2';
}): string {
  const customer = note.customerCnpj
    ? `<toma><CNPJ>${note.customerCnpj}</CNPJ><xNome>Cliente</xNome></toma>`
    : note.customerCpf
      ? `<toma><CPF>${note.customerCpf}</CPF><xNome>Cliente</xNome></toma>`
      : '';
  return REAL_NFSE_XML.replace(
    /<tpAmb>\d<\/tpAmb>/,
    `<tpAmb>${note.tpAmb ?? '1'}</tpAmb>`,
  )
    .replace(
      /<prest><CNPJ>\d+<\/CNPJ>/,
      `<prest><CNPJ>${note.providerCnpj}</CNPJ>`,
    )
    .replace(/<toma>.*?<\/toma>/s, customer)
    .replace(/<vServ>[^<]*<\/vServ>/, `<vServ>${note.amount}</vServ>`)
    .replace(
      /<dCompet>[^<]*<\/dCompet>/,
      `<dCompet>${note.competenceDate}</dCompet>`,
    )
    .replace(/<serie>[^<]*<\/serie>/, `<serie>${note.series}</serie>`)
    .replace(/<nDPS>[^<]*<\/nDPS>/, `<nDPS>${note.number}</nDPS>`);
}
