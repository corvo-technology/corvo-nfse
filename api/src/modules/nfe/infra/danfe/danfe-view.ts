import { XMLParser } from 'fast-xml-parser';
import {
  DASH,
  dash,
  formatCep,
  formatPhone,
  formatTaxId,
} from '@/modules/invoice/infra/danfse/danfse-format';

/** What the DANFE prints, already formatted. Built from the `nfeProc` (or from a bare `NFe`). */
export interface DanfeView {
  /** The 44 digits, for the barcode. */
  accessKey: string;
  /** The key in blocks of four digits. */
  accessKeyFormatted: string;
  number: string;
  series: string;
  /** `0` entry, `1` exit. */
  direction: string;
  homologation: boolean;
  natOp: string;
  /** "135260000000001 - 26/11/2026 10:00:05", or "-" while the NF-e has no protocol. */
  protocol: string;
  emitter: {
    name: string;
    addressLines: string[];
    ie: string;
    ieSt: string;
    taxId: string;
  };
  recipient: {
    name: string;
    taxId: string;
    district: string;
    zip: string;
    address: string;
    city: string;
    phone: string;
    state: string;
    ie: string;
    issueDate: string;
    exitDate: string;
    exitTime: string;
  };
  issuedAt: string;
  totalValue: string;
  payments: Array<{ method: string; value: string }>;
  taxes: Array<{ label: string; value: string }>;
  transport: Array<{ label: string; value: string }>;
  items: DanfeItem[];
  additionalInfo: string;
}

export interface DanfeItem {
  code: string;
  description: string;
  ncm: string;
  cst: string;
  cfop: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  total: string;
  discount: string;
  icmsBase: string;
  icmsValue: string;
  ipiValue: string;
  icmsRate: string;
  ipiRate: string;
}

export type Node = Record<string, unknown>;

const ARRAY_TAGS = new Set(['det', 'detPag', 'dup', 'vol', 'NFref', 'obsCont']);

export const nfeXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export const node = (value: unknown): Node =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Node)
    : {};

export const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

export const list = (value: unknown): Node[] =>
  Array.isArray(value) ? value.map(node) : value ? [node(value)] : [];

/** `12345.5` as `12.345,50` (no currency sign: the DANFE columns say "R$" once). */
export function formatDecimal(value: string | undefined, places = 2): string {
  const number = Number(value);
  if (!value || !Number.isFinite(number)) return DASH;
  return number.toLocaleString('pt-BR', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** The access key in blocks of four digits. */
export function formatAccessKey(key: string): string {
  return key.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

/** `10` as `000.000.010`. */
export function formatNumber(value: string): string {
  const padded = value.replace(/\D/g, '').padStart(9, '0');
  return padded.replace(/^(\d{3})(\d{3})(\d{3}).*$/, '$1.$2.$3');
}

/** An ISO date-time as written by the issuer (its own offset): `DD/MM/AAAA` and `HH:MM:SS`. */
export function splitDateTime(value: string): { date: string; time: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/.exec(value);
  if (!match) return { date: DASH, time: DASH };
  return {
    date: `${match[3]}/${match[2]}/${match[1]}`,
    time: match[4] ?? DASH,
  };
}

const PAYMENT_METHODS: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de crédito',
  '04': 'Cartão de débito',
  '05': 'Crédito loja',
  '10': 'Vale alimentação',
  '11': 'Vale refeição',
  '12': 'Vale presente',
  '13': 'Vale combustível',
  '15': 'Boleto bancário',
  '16': 'Depósito bancário',
  '17': 'Pagamento instantâneo (PIX)',
  '18': 'Transferência bancária, carteira digital',
  '19': 'Programa de fidelidade, cashback',
  '90': 'Sem pagamento',
  '99': 'Outros',
};

const FREIGHT: Record<string, string> = {
  '0': '0 - Contratação do frete por conta do remetente (CIF)',
  '1': '1 - Contratação do frete por conta do destinatário (FOB)',
  '2': '2 - Contratação do frete por conta de terceiros',
  '3': '3 - Transporte próprio por conta do remetente',
  '4': '4 - Transporte próprio por conta do destinatário',
  '9': '9 - Sem ocorrência de transporte',
};

function addressOf(ender: Node): string[] {
  const street = [text(ender.xLgr), text(ender.nro), text(ender.xCpl)]
    .filter(Boolean)
    .join(', ');
  const place = [text(ender.xBairro), text(ender.xMun), text(ender.UF)]
    .filter(Boolean)
    .join(' - ');
  return [street, place, formatCep(text(ender.CEP))].filter(
    (line) => line !== '' && line !== DASH,
  );
}

function itemOf(det: Node): DanfeItem {
  const prod = node(det.prod);
  const imposto = node(det.imposto);
  // ICMS holds one group (ICMSSN102, ICMS00...): whichever it is, its fields are read by name.
  const icms = node(Object.values(node(imposto.ICMS))[0]);
  const ipi = node(node(imposto.IPI).IPITrib);
  const cst = `${text(icms.orig)}${text(icms.CSOSN) || text(icms.CST)}`;
  const info = text(det.infAdProd);
  return {
    code: dash(text(prod.cProd)),
    description: info ? `${text(prod.xProd)}\n${info}` : dash(text(prod.xProd)),
    ncm: dash(text(prod.NCM)),
    cst: dash(cst),
    cfop: dash(text(prod.CFOP)),
    unit: dash(text(prod.uCom)),
    quantity: formatDecimal(text(prod.qCom), 4),
    unitPrice: formatDecimal(text(prod.vUnCom), 4),
    total: formatDecimal(text(prod.vProd)),
    discount: formatDecimal(text(prod.vDesc) || '0'),
    icmsBase: formatDecimal(text(icms.vBC) || '0'),
    icmsValue: formatDecimal(text(icms.vICMS) || '0'),
    ipiValue: formatDecimal(text(ipi.vIPI) || '0'),
    icmsRate: formatDecimal(text(icms.pICMS) || '0'),
    ipiRate: formatDecimal(text(ipi.pIPI) || '0'),
  };
}

function emitterOf(emit: Node): DanfeView['emitter'] {
  const ender = node(emit.enderEmit);
  const lines = addressOf(ender);
  const phone = formatPhone(text(ender.fone));
  if (phone !== DASH) lines.push(`Fone: ${phone}`);
  return {
    name: dash(text(emit.xNome)),
    addressLines: lines,
    ie: dash(text(emit.IE)),
    ieSt: dash(text(emit.IEST)),
    taxId: formatTaxId(text(emit.CNPJ) || text(emit.CPF)),
  };
}

function recipientOf(
  dest: Node,
  issued: { date: string },
  exit: { date: string; time: string },
): DanfeView['recipient'] {
  const ender = node(dest.enderDest);
  const street = [text(ender.xLgr), text(ender.nro), text(ender.xCpl)]
    .filter(Boolean)
    .join(', ');
  return {
    name: dash(text(dest.xNome)),
    taxId: formatTaxId(
      text(dest.CNPJ) || text(dest.CPF) || text(dest.idEstrangeiro),
    ),
    district: dash(text(ender.xBairro)),
    zip: formatCep(text(ender.CEP)),
    address: dash(street),
    city: dash(text(ender.xMun)),
    phone: formatPhone(text(ender.fone)),
    state: dash(text(ender.UF)),
    ie: dash(text(dest.IE)),
    issueDate: issued.date,
    exitDate: exit.date,
    exitTime: exit.time,
  };
}

function transportOf(transp: Node): DanfeView['transport'] {
  const transporter = node(transp.transporta);
  const volumes = list(transp.vol);
  const rows: DanfeView['transport'] = [
    {
      label: 'FRETE',
      value: FREIGHT[text(transp.modFrete)] ?? dash(text(transp.modFrete)),
    },
  ];
  if (text(transporter.xNome))
    rows.push(
      { label: 'TRANSPORTADOR', value: text(transporter.xNome) },
      {
        label: 'CNPJ/CPF',
        value: formatTaxId(text(transporter.CNPJ) || text(transporter.CPF)),
      },
    );
  if (volumes.length > 0)
    rows.push({
      label: 'VOLUMES',
      value: volumes
        .map((volume) =>
          [
            text(volume.qVol),
            text(volume.esp),
            text(volume.pesoB) ? `bruto ${text(volume.pesoB)} kg` : '',
          ]
            .filter(Boolean)
            .join(' '),
        )
        .join('; '),
    });
  return rows;
}

const TAX_FIELDS: Array<[string, string]> = [
  ['BASE DE CÁLCULO DO ICMS', 'vBC'],
  ['VALOR DO ICMS', 'vICMS'],
  ['BASE DE CÁLCULO DO ICMS ST', 'vBCST'],
  ['VALOR DO ICMS ST', 'vST'],
  ['VALOR TOTAL DOS PRODUTOS', 'vProd'],
  ['VALOR DO FRETE', 'vFrete'],
  ['VALOR DO SEGURO', 'vSeg'],
  ['DESCONTO', 'vDesc'],
  ['OUTRAS DESPESAS ACESSÓRIAS', 'vOutro'],
  ['VALOR DO IPI', 'vIPI'],
  ['VALOR TOTAL DA NOTA', 'vNF'],
];

/**
 * Reads the `nfeProc` (or a bare `NFe`) and returns what the DANFE prints. Pure: no I/O and no
 * rendering, so the formatting is tested without a PDF.
 */
export function toDanfeView(nfeProcXml: string): DanfeView {
  const tree = node(nfeXmlParser.parse(nfeProcXml));
  const proc = node(tree.nfeProc);
  const inf = node(node(proc.NFe ?? tree.NFe).infNFe);
  if (!inf.ide) throw new Error('The XML is not an NF-e');
  const ide = node(inf.ide);
  const total = node(node(inf.total).ICMSTot);
  const infProt = node(node(proc.protNFe).infProt);

  const key =
    text(infProt.chNFe) || text(inf['@_Id']).replace(/^NFe/, '') || '';
  const issued = splitDateTime(text(ide.dhEmi));
  const exit = splitDateTime(text(ide.dhSaiEnt));
  const received = splitDateTime(text(infProt.dhRecbto));
  const adicional = node(inf.infAdic);
  const money = (field: string) => formatDecimal(text(total[field]) || '0');

  return {
    accessKey: key,
    accessKeyFormatted: formatAccessKey(key),
    number: formatNumber(text(ide.nNF)),
    series: dash(text(ide.serie)),
    direction: dash(text(ide.tpNF)),
    homologation: (text(infProt.tpAmb) || text(ide.tpAmb)) === '2',
    natOp: dash(text(ide.natOp)),
    protocol: text(infProt.nProt)
      ? `${text(infProt.nProt)} - ${received.date} ${received.time}`
      : DASH,
    emitter: emitterOf(node(inf.emit)),
    recipient: recipientOf(node(inf.dest), issued, exit),
    issuedAt: `${issued.date} ${issued.time}`,
    totalValue: money('vNF'),
    payments: list(node(inf.pag).detPag).map((payment) => ({
      method: PAYMENT_METHODS[text(payment.tPag)] ?? dash(text(payment.tPag)),
      value: formatDecimal(text(payment.vPag)),
    })),
    taxes: TAX_FIELDS.map(([label, field]) => ({
      label,
      value: money(field),
    })),
    transport: transportOf(node(inf.transp)),
    items: list(inf.det).map(itemOf),
    additionalInfo: [text(adicional.infCpl), text(adicional.infAdFisco)]
      .filter(Boolean)
      .join('\n'),
  };
}
