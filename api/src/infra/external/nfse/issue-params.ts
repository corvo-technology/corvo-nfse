import {
  OpcaoSimplesNacional,
  RegimeApuracaoSimplesNacional,
  RegimeEspecialTributacao,
  TipoAmbienteDps,
  type EmitirParams,
} from 'open-nfse';
import type { IIssuePayload } from './nfse-fiscal-provider';

export type SefinEnvironment = 'production' | 'restricted';

export function issueParams(
  payload: IIssuePayload,
  sefin: SefinEnvironment = 'production',
): EmitirParams {
  const opSimpNac = String(
    payload.emitente.regime.opSimpNac,
  ) as OpcaoSimplesNacional;
  return {
    emitente: {
      cnpj: payload.emitente.cnpj,
      codMunicipio: payload.emitente.codMunicipio,
      inscricaoMunicipal: payload.emitente.municipalReg,
      regime: {
        opSimpNac,
        ...(opSimpNac === OpcaoSimplesNacional.MeEpp
          ? {
              regApTribSN: String(
                payload.emitente.regime.regApTribSN,
              ) as RegimeApuracaoSimplesNacional,
            }
          : {}),
        regEspTrib: String(
          payload.emitente.regime.regEspTrib,
        ) as RegimeEspecialTributacao,
      },
    },
    serie: payload.serie,
    nDPS: String(payload.number ?? 1),
    servico: payload.servico,
    valores: {
      ...payload.valores,
      vTotTrib: { vTotTribFed: 0, vTotTribEst: 0, vTotTribMun: 0 },
    },
    // `tomador` is optional in open-nfse's EmitirParams/BuildDpsParams;
    // anonymous consumer DPS are issued without it.
    ...(payload.tomador ? { tomador: payload.tomador } : {}),
    // A live invoice is only a production DPS when the Sefin target is production.
    tpAmb:
      payload.environment === 'live' && sefin === 'production'
        ? TipoAmbienteDps.Producao
        : TipoAmbienteDps.Homologacao,
    dhEmi: payload.issuedAt ?? new Date(),
    dCompet: new Date(
      `${(payload.competenceDate ?? new Date()).toISOString().slice(0, 10)}T12:00:00Z`,
    ),
    verAplic: payload.environment === 'test' ? 'Corvo-test' : 'Corvo',
  };
}
