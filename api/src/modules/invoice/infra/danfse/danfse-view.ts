import type { NFSe } from 'open-nfse';
import {
  DASH,
  dash,
  formatCep,
  formatCTribNac,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNbs,
  formatPercent,
  formatPhone,
  formatTaxId,
} from './danfse-format';

/**
 * Display model of the DANFSe (NT SE/CGNFS-e 008/2026, Anexo I). Everything here is already
 * formatted text: the renderer only decides where to draw it.
 */
export interface Cell {
  label: string;
  value: string;
  /** Grid column 0..3 (4 columns of 5.09 cm). */
  col: 0 | 1 | 2 | 3;
  span?: 1 | 2 | 3 | 4;
  shaded?: boolean;
  /** Label in 7 pt capitals (identification block). */
  caps?: boolean;
  /** Value in bold, a little larger (the net amount). */
  emphasis?: boolean;
}
export type Row = Cell[];
export interface GridBlock {
  kind: 'grid';
  /** Printed in the shaded cell at the start of the first row; that row must leave column 0 free. */
  title: string;
  rows: Row[];
}
export interface MessageBlock {
  kind: 'message';
  message: string;
}
export type Block = GridBlock | MessageBlock;

export interface DanfseView {
  title: string;
  header: {
    municipality: string;
    generator: string;
    environment: string;
    /** `tpAmb` 2: the NT requires the red "NFS-e SEM VALIDADE JURÍDICA". */
    homologation: boolean;
    watermark?: 'CANCELADA' | 'SUBSTITUÍDA';
  };
  accessKey: Cell;
  identification: Row[];
  qrUrl: string;
  parties: Block[];
  service: {
    row: GridBlock;
    codeDescription: string;
    description: string;
  };
  taxation: Block[];
  totals: GridBlock;
  additionalInfo: string[];
}

export interface DanfseOptions {
  /** Set when the invoice was cancelled or replaced: prints the diagonal watermark. */
  status?: 'cancelled' | 'replaced';
  /** IBGE code -> municipality name, for addresses that only carry the code. */
  municipalities?: Readonly<Record<string, string>>;
  /** Extra lines for "Informações Complementares" (e.g. the test-environment disclaimer). */
  notes?: readonly string[];
}

export const QR_BASE_URL =
  'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=';

const SITUACAO: Record<string, string> = {
  '100': 'NFS-e Gerada',
  '102': 'NFS-e por Decisão Judicial',
  '103': 'NFS-e Avulsa',
  '107': 'NFS-e MEI',
};
/** finNFSe, as the official generator (ReceitaFederal/calculadora-rtc-gerador-danfse) prints it. */
const FINALIDADE: Record<string, string> = {
  '0': 'NFS-e regular',
  '1': 'NFS-e de substituição',
  '2': 'NFS-e de ajuste',
};
const EMITENTE: Record<string, string> = {
  '1': 'Prestador',
  '2': 'Tomador',
  '3': 'Intermediário',
};
const SIMPLES: Record<string, string> = {
  '1': 'Não Optante',
  '2': 'Optante - Microempreendedor Individual (MEI)',
  '3': 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)',
};
const REGIME_APURACAO: Record<string, string> = {
  '1': 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional',
  '2': 'Tributos federais pelo Simples Nacional e ISSQN pela NFS-e',
  '3': 'Regime de apuração dos tributos federais e municipal pela NFS-e',
};
const REGIME_ESPECIAL: Record<string, string> = {
  '0': 'Nenhum',
  '1': 'Ato Cooperado (Cooperativa)',
  '2': 'Estimativa',
  '3': 'Microempresa Municipal',
  '4': 'Notário ou Registrador',
  '5': 'Profissional Autônomo',
  '6': 'Sociedade de Profissionais',
  '9': 'Outros',
};
const TRIBUTACAO_ISSQN: Record<string, string> = {
  '1': 'Operação Tributável',
  '2': 'Imunidade',
  '3': 'Exportação de Serviço',
  '4': 'Não Incidência',
};
const RETENCAO_ISSQN: Record<string, string> = {
  '1': 'Não Retido',
  '2': 'Retido pelo Tomador',
  '3': 'Retido pelo Intermediário',
};
const IMUNIDADE: Record<string, string> = {
  '0': 'Imunidade (tipo não informado)',
  '1': 'Patrimônio, renda ou serviços uns dos outros',
  '2': 'Templos de qualquer culto',
  '3': 'Partidos políticos',
  '4': 'Livros, jornais e periódicos',
  '5': 'Fonogramas e videofonogramas musicais',
};
const SUSPENSAO: Record<string, string> = {
  '1': 'Decisão Judicial',
  '2': 'Processo Administrativo',
};
const BENEFICIO: Record<string, string> = {
  '1': 'Isenção',
  '2': 'Redução da BC em %',
  '3': 'Redução da BC em R$',
  '4': 'Alíquota diferenciada',
};
const NAO_NIF: Record<string, string> = {
  '0': 'NIF não informado',
  '1': 'Dispensado do NIF',
  '2': 'NIF não exigido',
};

const cell = (
  label: string,
  value: string,
  col: Cell['col'],
  extra: Partial<Cell> = {},
): Cell => ({ label, value, col, ...extra });

type Identifier = NonNullable<
  NFSe['infNFSe']['DPS']['infDPS']['toma']
>['identificador'];

function personId(id: Identifier | undefined): string {
  if (!id) return DASH;
  if ('CNPJ' in id) return formatTaxId(id.CNPJ);
  if ('CPF' in id) return formatTaxId(id.CPF);
  if ('NIF' in id) return dash(id.NIF);
  return NAO_NIF[id.cNaoNIF] ?? DASH;
}

type Address = NonNullable<
  NonNullable<NFSe['infNFSe']['DPS']['infDPS']['toma']>['end']
>;

interface Places {
  name(code: string | undefined): string | undefined;
  uf(code: string | undefined): string | undefined;
}

function addressLines(end: Address | undefined, places: Places) {
  if (!end) return { street: DASH, city: DASH, codes: DASH };
  const street = [
    [end.xLgr, end.nro].filter(Boolean).join(', '),
    end.xCpl,
    end.xBairro,
  ]
    .filter((part) => part && part.trim() !== '')
    .join(' - ');
  const local = end.localidade;
  if ('endNac' in local) {
    const name = places.name(local.endNac.cMun);
    const uf = places.uf(local.endNac.cMun);
    return {
      street: dash(street),
      city: name ? [name, uf].filter(Boolean).join(' / ') : DASH,
      codes: `${dash(local.endNac.cMun)} / ${formatCep(local.endNac.CEP)}`,
    };
  }
  const abroad = local.endExt;
  return {
    street: dash(street),
    city:
      [abroad.xCidade, abroad.xEstProvReg].filter(Boolean).join(' / ') || DASH,
    codes: `${dash(abroad.cPais)} / ${dash(abroad.cEndPost)}`,
  };
}

function buildPlaces(
  nfse: NFSe,
  extra: DanfseOptions['municipalities'],
): Places {
  const info = nfse.infNFSe;
  const names = new Map<string, string>(Object.entries(extra ?? {}));
  const ufs = new Map<string, string>();
  names.set(info.emit.enderNac.cMun, info.xLocEmi);
  ufs.set(info.emit.enderNac.cMun, info.emit.enderNac.UF);
  if (info.cLocIncid && info.xLocIncid)
    names.set(info.cLocIncid, info.xLocIncid);
  const service = info.DPS.infDPS.serv.locPrest;
  if ('cLocPrestacao' in service)
    names.set(service.cLocPrestacao, info.xLocPrestacao);
  // A municipality with the same code as the issuer's shares its state.
  return {
    name: (code) => (code ? names.get(code) : undefined),
    uf: (code) => (code ? ufs.get(code) : undefined),
  };
}

function partyBlock(
  title: string,
  notIdentified: string,
  party:
    | {
        identificador: Identifier;
        IM?: string;
        xNome?: string;
        end?: Address;
        fone?: string;
        email?: string;
      }
    | undefined,
  places: Places,
  withMunicipalRegistration: boolean,
): Block {
  if (!party) return { kind: 'message', message: notIdentified };
  const address = addressLines(party.end, places);
  return {
    kind: 'grid',
    title,
    rows: [
      [
        cell('CNPJ / CPF / NIF', personId(party.identificador), 1),
        ...(withMunicipalRegistration
          ? [cell('Indicador Municipal (Inscrição)', dash(party.IM), 2)]
          : []),
        cell('Telefone', formatPhone(party.fone), 3),
      ],
      [
        cell('Nome / Nome Empresarial', dash(party.xNome), 0, { span: 2 }),
        cell('Município / Sigla UF', address.city, 2),
        cell('Código IBGE / CEP', address.codes, 3),
      ],
      [
        cell('Endereço', address.street, 0, { span: 2 }),
        cell('E-mail', dash(party.email), 2, { span: 2 }),
      ],
    ],
  };
}

const number = (value: number | undefined): string => formatMoney(value);

function totalsLine(
  label: string,
  value: number | undefined,
  percent: boolean,
): string {
  if (value === undefined) return '';
  return `${label}: ${percent ? formatPercent(value) : formatMoney(value)}`;
}

function approximateTaxes(nfse: NFSe): string | undefined {
  const total = nfse.infNFSe.DPS.infDPS.valores.trib.totTrib;
  let parts: string[] = [];
  if ('vTotTrib' in total) {
    parts = [
      totalsLine('Federais', total.vTotTrib.vTotTribFed, false),
      totalsLine('Estaduais', total.vTotTrib.vTotTribEst, false),
      totalsLine('Municipais', total.vTotTrib.vTotTribMun, false),
    ];
  } else if ('pTotTrib' in total) {
    parts = [
      totalsLine('Federais', total.pTotTrib.pTotTribFed, true),
      totalsLine('Estaduais', total.pTotTrib.pTotTribEst, true),
      totalsLine('Municipais', total.pTotTrib.pTotTribMun, true),
    ];
  } else if ('pTotTribSN' in total) {
    parts = [totalsLine('Simples Nacional', total.pTotTribSN, true)];
  } else {
    return undefined;
  }
  return `Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: ${parts.filter(Boolean).join('; ')}`;
}

function additionalInformation(
  nfse: NFSe,
  notes: readonly string[] = [],
): string[] {
  const info = nfse.infNFSe;
  const dps = info.DPS.infDPS;
  const lines: string[] = [];
  const complement = dps.serv.infoCompl;
  if (complement?.xInfComp) lines.push(complement.xInfComp);
  if (complement?.xPed) lines.push(`Pedido: ${complement.xPed}`);
  if (complement?.docRef)
    lines.push(`Documento de referência: ${complement.docRef}`);
  if (dps.subst) lines.push(`NFS-e Subst.: ${dps.subst.chSubstda}`);
  const works = dps.serv.obra;
  if (works) {
    const id = works.identificacao;
    const code = 'cObra' in id ? id.cObra : 'cCIB' in id ? id.cCIB : undefined;
    if (code) lines.push(`Cod. Obra: ${code}`);
    if (works.inscImobFisc) lines.push(`Insc. Imob.: ${works.inscImobFisc}`);
  }
  const event = dps.serv.atvEvento?.identificacao;
  if (event && 'idAtvEvt' in event) lines.push(`Cod. Evt.: ${event.idAtvEvt}`);
  if (info.xOutInf) lines.push(info.xOutInf);
  const approximate = approximateTaxes(nfse);
  if (approximate) lines.push(approximate);
  for (const note of notes) if (!lines.includes(note)) lines.push(note);
  return lines;
}

function ibsCbsBlock(nfse: NFSe): GridBlock {
  const info = nfse.infNFSe;
  const dpsGroup = info.DPS.infDPS.IBSCBS;
  const group = info.IBSCBS;
  const classification = dpsGroup?.valores.trib.gIBSCBS;
  const place = group
    ? `${dash(dpsGroup?.cIndOp)} / ${dash(group.cLocalidadeIncid)} / ${dash(group.xLocalidadeIncid)}`
    : DASH;
  const reduction = group
    ? `${formatPercent(group.valores.uf.pRedAliqUF ?? group.valores.mun.pRedAliqMun)} / ${formatPercent(group.valores.fed.pRedAliqCBS)}`
    : DASH;
  const rate = group
    ? `${formatPercent(group.valores.uf.pIBSUF)} / ${formatPercent(group.valores.mun.pIBSMun)}`
    : DASH;
  return {
    kind: 'grid',
    title: 'TRIBUTAÇÃO IBS / CBS',
    rows: [
      [
        cell(
          'CST / cClassTrib',
          classification
            ? `${classification.CST} / ${classification.cClassTrib}`
            : DASH,
          1,
        ),
        cell(
          'Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF',
          place,
          2,
          { span: 2 },
        ),
      ],
      [
        cell(
          'Exclusões e Reduções da Base de Cálculo',
          number(group?.valores.vCalcReeRepRes),
          0,
        ),
        cell(
          'Base de Cálculo Após Exclusões e Reduções',
          number(group?.valores.vBC),
          1,
        ),
        cell('Red. Alíquota IBS / Red. Alíquota CBS', reduction, 2),
        cell('Alíquota - IBS UF / IBS Mun', rate, 3),
      ],
      [
        cell(
          'Alíq. Efetiva Municipal - IBS',
          formatPercent(group?.valores.mun.pAliqEfetMun),
          0,
        ),
        cell(
          'Valor Apurado Municipal - IBS',
          number(group?.totCIBS.gIBS.gIBSMunTot.vIBSMun),
          1,
        ),
        cell(
          'Alíq. Efetiva Estadual - IBS',
          formatPercent(group?.valores.uf.pAliqEfetUF),
          2,
        ),
        cell(
          'Valor Apurado Estadual - IBS',
          number(group?.totCIBS.gIBS.gIBSUFTot.vIBSUF),
          3,
        ),
      ],
      [
        cell(
          'Valor Total Apurado - IBS',
          number(group?.totCIBS.gIBS.vIBSTot),
          0,
        ),
        cell('Alíquota - CBS', formatPercent(group?.valores.fed.pCBS), 1),
        cell(
          'Alíquota Efetiva - CBS',
          formatPercent(group?.valores.fed.pAliqEfetCBS),
          2,
        ),
        cell('Valor Total Apurado - CBS', number(group?.totCIBS.gCBS.vCBS), 3),
      ],
    ],
  };
}

function municipalBlock(nfse: NFSe, places: Places): Block {
  const info = nfse.infNFSe;
  const dps = info.DPS.infDPS;
  const municipal = dps.valores.trib.tribMun;
  if (String(municipal.tribISSQN) === '4') {
    return {
      kind: 'message',
      message: 'TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN',
    };
  }
  const regime = dps.prest.regTrib.regEspTrib;
  const incidence = info.xLocIncid
    ? [info.xLocIncid, places.uf(info.cLocIncid)].filter(Boolean).join(' / ')
    : municipal.cPaisResult
      ? `País ${municipal.cPaisResult}`
      : DASH;
  const rows: Row[] = [
    [
      cell(
        'Tipo de Tributação do ISSQN',
        TRIBUTACAO_ISSQN[municipal.tribISSQN] ?? DASH,
        1,
      ),
      cell('Município / Sigla UF / País de Incidência do ISSQN', incidence, 2, {
        span: 2,
      }),
    ],
  ];
  // Note 5 of the NT: a line with no data in any of its fields may be left out.
  const hasLineTwo =
    String(regime) !== '0' ||
    municipal.tpImunidade !== undefined ||
    municipal.exigSusp !== undefined;
  if (hasLineTwo) {
    rows.push([
      cell(
        'Regime Especial de Tributação do ISSQN',
        REGIME_ESPECIAL[regime] ?? DASH,
        0,
      ),
      cell(
        'Tipo de Imunidade do ISSQN',
        municipal.tpImunidade
          ? (IMUNIDADE[municipal.tpImunidade] ?? DASH)
          : DASH,
        1,
      ),
      cell(
        'Suspensão da Exigibilidade do ISSQN',
        municipal.exigSusp
          ? (SUSPENSAO[municipal.exigSusp.tpSusp] ?? DASH)
          : DASH,
        2,
      ),
      cell('Número Processo Suspensão', dash(municipal.exigSusp?.nProcesso), 3),
    ]);
  }
  const values = info.valores;
  const discount = dps.valores.vDescCondIncond?.vDescIncond;
  if (
    values.tpBM !== undefined ||
    values.vCalcBM !== undefined ||
    values.vCalcDR !== undefined ||
    discount !== undefined
  ) {
    rows.push([
      cell(
        'Benefício Municipal',
        values.tpBM ? (BENEFICIO[values.tpBM] ?? DASH) : DASH,
        0,
      ),
      cell('Cálculo do BM', number(values.vCalcBM), 1),
      cell('Total Deduções/Reduções', number(values.vCalcDR), 2),
      cell('Desconto Incondicionado', number(discount), 3),
    ]);
  }
  rows.push([
    cell('BC ISSQN', number(values.vBC), 0),
    cell('Alíquota Aplicada', formatPercent(values.pAliqAplic), 1),
    cell('Retenção do ISSQN', RETENCAO_ISSQN[municipal.tpRetISSQN] ?? DASH, 2),
    cell('ISSQN Apurado', number(values.vISSQN), 3),
  ]);
  return { kind: 'grid', title: 'TRIBUTAÇÃO MUNICIPAL (ISSQN)', rows };
}

function federalBlock(nfse: NFSe): GridBlock {
  const dps = nfse.infNFSe.DPS.infDPS;
  const federal = dps.valores.trib.tribFed;
  const rows: Row[] = [
    [
      cell('IRRF', number(federal?.vRetIRRF), 1),
      cell('Contribuição Previdenciária - Retida', number(federal?.vRetCP), 2),
      cell('Contribuições Sociais - Retidas', number(federal?.vRetCSLL), 3),
    ],
  ];
  // Note 6 of the NT: the PIS/COFINS line is printed for competences up to 2026.
  if (dps.dCompet.getUTCFullYear() <= 2026) {
    rows.push([
      cell(
        'PIS - Débito Apuração Própria',
        number(federal?.piscofins?.vPis),
        0,
      ),
      cell(
        'COFINS - Débito Apuração Própria',
        number(federal?.piscofins?.vCofins),
        1,
      ),
      cell(
        'Descrição Contrib. Sociais - Retidas',
        federal?.vRetCSLL ? 'CSLL retida' : DASH,
        2,
        { span: 2 },
      ),
    ]);
  }
  return { kind: 'grid', title: 'TRIBUTAÇÃO FEDERAL (EXCETO CBS)', rows };
}

export function buildDanfseView(
  nfse: NFSe,
  options: DanfseOptions = {},
): DanfseView {
  const info = nfse.infNFSe;
  const dps = info.DPS.infDPS;
  const places = buildPlaces(nfse, options.municipalities);
  const issuer = info.emit;
  const provider = dps.prest;
  const homologation = String(dps.tpAmb) === '2';

  const providerBlock: GridBlock = {
    kind: 'grid',
    title: 'PRESTADOR / FORNECEDOR',
    rows: (() => {
      const address = addressLines(
        provider.end ?? {
          localidade: {
            endNac: { cMun: issuer.enderNac.cMun, CEP: issuer.enderNac.CEP },
          },
          xLgr: issuer.enderNac.xLgr,
          nro: issuer.enderNac.nro,
          xCpl: issuer.enderNac.xCpl,
          xBairro: issuer.enderNac.xBairro,
        },
        places,
      );
      const regime = provider.regTrib;
      return [
        [
          cell('CNPJ / CPF / NIF', personId(provider.identificador), 1),
          cell(
            'Indicador Municipal (Inscrição)',
            dash(provider.IM ?? issuer.IM),
            2,
          ),
          cell('Telefone', formatPhone(provider.fone ?? issuer.fone), 3),
        ],
        [
          cell(
            'Nome / Nome Empresarial',
            dash(provider.xNome ?? issuer.xNome),
            0,
            { span: 2 },
          ),
          cell('Município / Sigla UF', address.city, 2),
          cell('Código IBGE / CEP', address.codes, 3),
        ],
        [
          cell('Endereço', address.street, 0, { span: 2 }),
          cell('E-mail', dash(provider.email ?? issuer.email), 2, { span: 2 }),
        ],
        [
          cell(
            'Simples Nacional na Data de Competência',
            SIMPLES[regime.opSimpNac] ?? DASH,
            0,
            { span: 2 },
          ),
          cell(
            'Regime de Apuração Tributária pelo SN',
            regime.regApTribSN
              ? (REGIME_APURACAO[regime.regApTribSN] ?? DASH)
              : DASH,
            2,
            { span: 2 },
          ),
        ],
      ];
    })(),
  };

  const recipient = dps.IBSCBS?.dest;
  const recipientBlock: Block =
    String(dps.IBSCBS?.indDest) === '0'
      ? {
          kind: 'message',
          message: 'O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO',
        }
      : partyBlock(
          'DESTINATÁRIO DA OPERAÇÃO',
          'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e',
          recipient,
          places,
          false,
        );

  const code = dps.serv.cServ;
  const place = dps.serv.locPrest;
  const servicePlace =
    'cLocPrestacao' in place
      ? [info.xLocPrestacao, places.uf(place.cLocPrestacao)]
          .filter(Boolean)
          .join(' / ')
      : `País ${place.cPaisPrestacao}`;
  const taxes = dps.valores.vDescCondIncond;
  const ibsTotal = info.IBSCBS
    ? info.IBSCBS.totCIBS.gIBS.vIBSTot + info.IBSCBS.totCIBS.gCBS.vCBS
    : undefined;

  return {
    title: `DANFSe ${info.chaveAcesso}`,
    header: {
      municipality: `Município: ${[info.xLocEmi, issuer.enderNac.UF].filter(Boolean).join(' / ')}`,
      generator: `Ambiente Gerador: ${String(info.ambGer) === '1' ? 'Prefeitura' : 'Sistema Nacional NFS-e'}`,
      environment: `Tipo de Ambiente: ${homologation ? 'Homologação' : 'Produção'}`,
      homologation,
      watermark:
        options.status === 'cancelled'
          ? 'CANCELADA'
          : options.status === 'replaced'
            ? 'SUBSTITUÍDA'
            : undefined,
    },
    accessKey: cell('Chave de Acesso da NFS-e', info.chaveAcesso, 0, {
      span: 4,
      caps: true,
    }),
    identification: [
      [
        cell('Número da NFS-e', dash(info.nNFSe), 0, { caps: true }),
        cell('Competência da NFS-e', formatDate(dps.dCompet), 1, {
          caps: true,
        }),
        cell(
          'Data e Hora da Emissão da NFS-e',
          formatDateTime(info.dhProc),
          2,
          { caps: true },
        ),
      ],
      [
        cell('Número da DPS', dash(dps.nDPS), 0, { caps: true }),
        cell('Série da DPS', dash(dps.serie), 1, { caps: true }),
        cell('Data e Hora da Emissão da DPS', formatDateTime(dps.dhEmi), 2, {
          caps: true,
        }),
      ],
      [
        cell('Emitente da NFS-e', EMITENTE[dps.tpEmit] ?? DASH, 0, {
          caps: true,
          shaded: true,
        }),
        cell('Situação da NFS-e', SITUACAO[info.cStat] ?? dash(info.cStat), 1, {
          caps: true,
        }),
        cell('Finalidade', FINALIDADE[String(dps.IBSCBS?.finNFSe)] ?? DASH, 2, {
          caps: true,
        }),
      ],
    ],
    qrUrl: `${QR_BASE_URL}${info.chaveAcesso}`,
    parties: [
      providerBlock,
      partyBlock(
        'TOMADOR / ADQUIRENTE',
        'TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e',
        dps.toma,
        places,
        true,
      ),
      recipientBlock,
      partyBlock(
        'INTERMEDIÁRIO DA OPERAÇÃO',
        'INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e',
        dps.interm,
        places,
        true,
      ),
    ],
    service: {
      row: {
        kind: 'grid',
        title: 'SERVIÇO PRESTADO',
        rows: [
          [
            cell(
              'Código de Tributação Nacional / Municipal',
              `${formatCTribNac(code.cTribNac)} / ${dash(code.cTribMun)}`,
              1,
            ),
            cell('Código da NBS', formatNbs(code.cNBS), 2),
            cell('Local da Prestação / Sigla UF / País', dash(servicePlace), 3),
          ],
        ],
      },
      codeDescription: dash(info.xTribMun ?? info.xTribNac),
      description: dash(code.xDescServ),
    },
    // The IBS/CBS block only appears when the note carries the group; otherwise it would be all dashes.
    taxation: [
      municipalBlock(nfse, places),
      federalBlock(nfse),
      ...(info.IBSCBS || dps.IBSCBS ? [ibsCbsBlock(nfse)] : []),
    ],
    totals: {
      kind: 'grid',
      title: 'VALOR TOTAL DA NFS-E',
      rows: [
        [
          cell(
            'Valor da Operação / Serviço',
            number(dps.valores.vServPrest.vServ),
            1,
          ),
          cell('Desconto Incondicionado', number(taxes?.vDescIncond), 2),
          cell('Desconto Condicionado', number(taxes?.vDescCond), 3),
        ],
        [
          cell(
            'Total das Retenções (ISSQN / Federais)',
            number(info.valores.vTotalRet),
            0,
          ),
          cell('Valor Líquido da NFS-e', number(info.valores.vLiq), 1, {
            emphasis: true,
          }),
          cell('Total do IBS/CBS', number(ibsTotal), 2),
          cell(
            'Valor Líquido da NFS-e + IBS/CBS',
            number(info.IBSCBS?.totCIBS.vTotNF ?? info.valores.vLiq),
            3,
            { shaded: true, emphasis: true },
          ),
        ],
      ],
    },
    additionalInfo: additionalInformation(nfse, options.notes),
  };
}
