import {
  DASH,
  dash,
  formatCep,
  formatTaxId,
} from '@/modules/invoice/infra/danfse/danfse-format';
import {
  formatAccessKey,
  formatDecimal,
  list,
  node,
  nfeXmlParser,
  splitDateTime,
  text,
} from '@/modules/nfe/infra/danfe/danfe-view';

/**
 * What the DANFCE prints, already formatted. Built from the `nfeProc` of an authorized NFC-e or
 * from the bare `NFe` of one issued in contingency (no protocol yet).
 */
export interface DanfceView {
  issuer: { name: string; cnpj: string; address: string };
  items: DanfceItem[];
  totals: {
    /** Quantity of items (lines), not of units. */
    count: number;
    vProd: string;
    vDesc: string;
    vNF: string;
    vTroco: string;
  };
  payments: Array<{ label: string; amount: string }>;
  consult: {
    urlChave: string;
    /** The 44 digits in blocks of four. */
    accessKeyGroups: string;
  };
  consumer: string;
  ident: {
    number: string;
    series: string;
    issuedAt: string;
    /** Empty while there is no protocol (NFC-e in contingency). */
    protocol: string;
    authorizedAt: string;
  };
  qrCode: string;
  additionalInfo: string;
  messages: string[];
}

export interface DanfceItem {
  code: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  total: string;
}

export interface DanfceViewOptions {
  homologation: boolean;
  cancelled?: boolean;
}

export const HOMOLOGATION_MESSAGE =
  'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL';
export const CONTINGENCY_MESSAGES = [
  'EMITIDA EM CONTINGÊNCIA',
  'Pendente de autorização',
];
export const CANCELLED_MESSAGE = 'NFC-e CANCELADA';
export const NO_CONSUMER = 'CONSUMIDOR NÃO IDENTIFICADO';

/** `tPag` as the DANFCE prints it. */
const PAYMENT_LABELS: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de Crédito',
  '04': 'Cartão de Débito',
  '05': 'Crédito Loja',
  '10': 'Vale Alimentação',
  '11': 'Vale Refeição',
  '12': 'Vale Presente',
  '13': 'Vale Combustível',
  '15': 'Boleto Bancário',
  '16': 'Depósito Bancário',
  '17': 'Pagamento Instantâneo (PIX)',
  '18': 'Transferência Bancária, Carteira Digital',
  '19': 'Programa de Fidelidade, Cashback',
  '90': 'Sem Pagamento',
  '99': 'Outros',
};

/** `2.0000` as `2` and `1.5` as `1,5`: the quantity of a sale at the counter. */
function formatQuantity(value: string): string {
  const number = Number(value);
  if (!value || !Number.isFinite(number)) return DASH;
  return number.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

/** The unit price keeps the cents and shows up to four places when the issuer used them. */
function formatUnitPrice(value: string): string {
  const number = Number(value);
  if (!value || !Number.isFinite(number)) return DASH;
  return number.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function addressOf(emit: Record<string, unknown>): string {
  const ender = node(emit.enderEmit);
  const place = [text(ender.xMun), text(ender.UF)].filter(Boolean).join(' - ');
  const cep = formatCep(text(ender.CEP));
  return [
    text(ender.xLgr),
    text(ender.nro),
    text(ender.xCpl),
    text(ender.xBairro),
    place,
    cep === DASH ? '' : cep,
  ]
    .filter(Boolean)
    .join(', ');
}

/** The CPF is masked (`***.456.789-**`): the cupom is handed over and thrown away. */
export function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return DASH;
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

function consumerOf(dest: Record<string, unknown>): string {
  if (text(dest.CPF)) return `CONSUMIDOR - CPF ${maskCpf(text(dest.CPF))}`;
  if (text(dest.CNPJ))
    return `CONSUMIDOR - CNPJ ${formatTaxId(text(dest.CNPJ))}`;
  if (text(dest.idEstrangeiro))
    return `CONSUMIDOR - ID ${text(dest.idEstrangeiro)}`;
  return NO_CONSUMER;
}

function itemOf(det: Record<string, unknown>): DanfceItem {
  const prod = node(det.prod);
  const info = text(det.infAdProd);
  return {
    code: dash(text(prod.cProd)),
    description: info ? `${text(prod.xProd)}\n${info}` : dash(text(prod.xProd)),
    quantity: formatQuantity(text(prod.qCom)),
    unit: dash(text(prod.uCom)),
    unitPrice: formatUnitPrice(text(prod.vUnCom)),
    total: formatDecimal(text(prod.vProd)),
  };
}

/**
 * Reads the `nfeProc` (or a bare `NFe`) of an NFC-e and returns what the DANFCE prints. Pure: no I/O
 * and no rendering.
 */
export function toDanfceView(xml: string, opts: DanfceViewOptions): DanfceView {
  const tree = node(nfeXmlParser.parse(xml));
  const proc = node(tree.nfeProc);
  const nfe = node(proc.NFe ?? tree.NFe);
  const inf = node(nfe.infNFe);
  if (!inf.ide || text(node(inf.ide).mod) !== '65')
    throw new Error('The XML is not an NFC-e');
  const ide = node(inf.ide);
  const total = node(node(inf.total).ICMSTot);
  const infProt = node(node(proc.protNFe).infProt);
  const supl = node(nfe.infNFeSupl);
  const pag = node(inf.pag);
  const adic = node(inf.infAdic);

  const key =
    text(infProt.chNFe) || text(inf['@_Id']).replace(/^NFe/, '') || '';
  const issued = splitDateTime(text(ide.dhEmi));
  const received = splitDateTime(text(infProt.dhRecbto));
  const protocol = text(infProt.nProt);
  const money = (field: string) => formatDecimal(text(total[field]) || '0');
  const emit = node(inf.emit);
  const details = list(inf.det);

  const messages: string[] = [];
  if (opts.homologation) messages.push(HOMOLOGATION_MESSAGE);
  if (text(ide.tpEmis) === '9' || !protocol)
    messages.push(...CONTINGENCY_MESSAGES);
  if (opts.cancelled) messages.push(CANCELLED_MESSAGE);

  return {
    issuer: {
      name: dash(text(emit.xNome)),
      cnpj: formatTaxId(text(emit.CNPJ) || text(emit.CPF)),
      address: addressOf(emit),
    },
    items: details.map(itemOf),
    totals: {
      count: details.length,
      vProd: money('vProd'),
      vDesc: money('vDesc'),
      vNF: money('vNF'),
      vTroco: formatDecimal(text(pag.vTroco) || '0'),
    },
    payments: list(pag.detPag).map((payment) => ({
      label: PAYMENT_LABELS[text(payment.tPag)] ?? dash(text(payment.tPag)),
      amount: formatDecimal(text(payment.vPag)),
    })),
    consult: {
      urlChave: text(supl.urlChave),
      accessKeyGroups: formatAccessKey(key),
    },
    consumer: inf.dest ? consumerOf(node(inf.dest)) : NO_CONSUMER,
    ident: {
      number: dash(text(ide.nNF)),
      series: dash(text(ide.serie)),
      issuedAt: `${issued.date} ${issued.time}`,
      protocol,
      authorizedAt: protocol ? `${received.date} ${received.time}` : '',
    },
    qrCode: text(supl.qrCode),
    additionalInfo: [text(adic.infCpl), text(adic.infAdFisco)]
      .filter(Boolean)
      .join('\n'),
    messages,
  };
}
