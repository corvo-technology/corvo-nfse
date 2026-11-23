# NT 009 (NFS-e Nacional): plano de prontidão da Corvo

Data: 2026-11-23. Escopo: mapear o impacto e preparar a virada. Este documento não muda código.

## 1. Resumo

- A Corvo **já tem a release 1 da NT 009 implementada** (PR #121): o layout `nt009-r1`, a troca por ambiente/data (`FISCAL_DPS_LAYOUT=auto`) e os códigos 99.02 a 99.04. O que falta é **provar que funciona de ponta a ponta** e **decidir como virar em produção**, não reescrever o montador da DPS.
- O risco principal para 01/12/2026 é de **decisão e de teste**, não de código:
  1. o corte automático (`auto`) liga `nt009-r1` na produção à 00:00 de 01/12, mas não encontramos o XSD de produção da NT 009; só validamos contra o XSD de Produção Restrita 20261020;
  2. não sabemos se a Sefin continua aceitando o layout antigo depois de 30/11;
  3. nenhuma emissão nossa foi aceita pela Sefin com `nt009-r1` ainda (só testes contra o XSD).
- As releases 2 e 3 (grupos do Simples, `gPgtoVinc`, locação, notas de crédito e débito) **não estão na lib nem na Corvo**. Dependem de XSD que ainda não foi publicado.

## 2. Fontes oficiais

- Ato Técnico Conjunto RFB/CGIBS nº 7, de 09/10/2026, aprova a NT 009 v1.01 (11/09/2026) e a NT 010: <https://www.gov.br/nfse/pt-br/noticias/publicado-o-ato-tecnico-conjunto-rfb-cgibs-no-7-aprovando-a-versao-1-01-da-nota-tecnica-009-nfs-e-e-a-nota-tecnica-010-da-nfs-e-via>
- Documentação técnica (página RTC): <https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc>
- Release 1 no ambiente de testes (releases 1 a 3 previstas para 01/12/2026): <https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-informa-disponibilizadas-no-ambiente-de-testes-o-release-1-das-evolucoes-da-nota-tecnica-009>

**Divergência de versão do anexo.** O Ato aprova o leiaute no Anexo VI **V1.04.01**; a página RTC do gov.br lista o Anexo VII **v1.03.00**. Usamos V1.04.01 (é o que o Ato cita) e tratamos a página como possivelmente desatualizada. Reconferir antes do corte.

## 3. Linha do tempo

| Data | O que | Situação |
|---|---|---|
| 09/10/2026 | Ato Técnico Conjunto nº 7 aprova a NT 009 v1.01 | Certo (fonte oficial) |
| 20/10/2026 | XSD de Produção Restrita (release 1) usado pela lib | Certo (é o que a lib embute) |
| 30/11/2026 | Fim da validade do layout atual (NT 004 v2.0) | Certo |
| 01/12/2026 | Releases 1 a 3 em produção | **Esperado**: o cronograma formal ainda não saiu |
| Depois de 30/11 | O layout antigo continua aceito? | **Não encontramos**; ver perguntas abertas |
| Releases 2 e 3 | XSD, datas | **Desconhecido**; nenhum XSD encontrado |

## 4. Como a Corvo está hoje

- **Onde o layout é escolhido:** `FISCAL_DPS_LAYOUT` (`rtc-v1.01` padrão, `nt009-r1` ou `auto`) em `api/src/infra/config/env.schema.ts:318`. A regra está em `api/src/modules/invoice/domain/fiscal/dps/dps-layout.ts` (`resolveDpsLayout`; corte padrão `2026-12-01T00:00:00-03:00` via `FISCAL_NT009_CUTOVER_AT`; decidido pelo `dhEmi` de cada nota). O mesmo resolvedor roda no montador (`dps-builder.ts:210-270`) e no cliente da lib (`api/src/infra/external/nfse/open-nfse.provider.ts:159-168`).
- **Trava de segurança:** `nt009-r1` explícito só sobe com `NFSE_SEFIN_ENVIRONMENT=restricted` (`env.schema.ts:490-502`). O layout está registrado como `restricted_and_scheduled`, e não `in_production` (`dps-layout.ts:20`).
- **Lib `open-nfse`:** `api/package.json:92` fixa o fork `corvo-technology/open-nfse` no commit `a4bb1c8` (branch `release/corvo-nt009-r1`). No npm, a última versão é `0.11.1` (`next` = `0.12.0-rc.1`, de 03/11/2026); **nenhuma das duas tem a NT 009**. O fork vem de `Fm-s/open-nfse`; não achamos issue nem PR de NT 009 abertos no fork. O fork traz o XSD `schemas/1.01-prodrest-20261020` e o tipo de layout `'v1.01' | 'nt009-r1'`.
- **O que a lib faz no `nt009-r1`** (`src/nfse/build-xml.ts` e `parse-xml.ts` do fork): `finNFSe` sobe para `infDPS`; `CST` e `cClassTrib` ficam direto em `IBSCBS/valores/trib`; `vDedRed` vira `vAjusteBC`; ao ler uma NFS-e, aceita os nomes novos e antigos (`vCalcAjusteBCISSQN` entra como `vCalcDR`). **O que ela recusa:** grupo `imovel` reestruturado, `gReeRepRes` e dedução por documentos.
- Como a lib mantém o modelo antigo por dentro, o código da Corvo continua escrevendo `gIBSCBS`, `vDedRed` etc. e a lib traduz.
- **CNPJ alfanumérico:** já tratado (`api/src/shared/fiscal/cnpj.ts:20`, `danfse-format.ts:15`).

## 5. Tabela de impacto

Legenda: esforço S (até 1 dia), M (2 a 4 dias), L (mais de 4 dias). "Dia 1" = precisa estar certo em 01/12/2026. Os números de linha são de `main` em 23/11/2026.

| # | Mudança da NT 009 | O que quebra | O que mudar (arquivo) | Esforço | Dia 1? |
|---|---|---|---|---|---|
| 1 | `CST`/`cClassTrib` sobem para `IBSCBS/valores/trib`; `gIBSCBS` vira opcional (CST 400, 410, 820 sem `gIBSCBS`) | Montador: `dps-builder.ts:355-361` monta `gIBSCBS{CST,cClassTrib}` e a lib traduz (feito). Leitura: `danfse-view.ts:333` lê `trib.gIBSCBS`; com CST sem `gIBSCBS` a classificação pode sair vazia ou estourar | Testar com NFS-e autorizada real do layout novo; tornar a leitura tolerante se a lib devolver outra forma. Hoje só existe a fixture do layout antigo (`danfse/__fixtures__/authorized-nfse.xml`) | M | **Sim** |
| 2 | `vDedRed` vira `vAjusteBC`; `vCalcDR` vira `vCalcAjusteBCISSQN`; `vCalcReeRepRes` vira `vCalcAjusteBCIBSCBS`; novo `vCalcAjusteBCLocImoveis` | Escrita: `dps-builder.ts:534-546` usa `vDedRed.vDR`, traduzido pela lib (feito). Leitura: `danfse-view.ts:488` (`vCalcDR`) funciona pelo apelido da lib; `:365` (`vCalcReeRepRes`) **não** tem apelido no parser, então o campo sai vazio; `vCalcAjusteBCLocImoveis` não é lido | Pedir no fork o apelido de `vCalcAjusteBCIBSCBS` e a leitura do campo de locação; o DANFSe mostra o campo novo só se existir | S | Sim para `vCalcDR`; o resto pode esperar |
| 3 | Códigos 99.02 a 99.04 (só pela API) | Feito: `nt009-events.ts` e recusa no layout antigo (`dps-builder.ts:272-300`). Falta provar na Sefin | Teste na Produção Restrita com cada código | S | Sim, se oferecermos esses códigos |
| 4 | Troca de layout na virada | `auto` vira para `nt009-r1` na produção às 00:00 de 01/12 mesmo sem XSD de produção publicado. Se a Sefin não estiver pronta, **todas** as notas live rejeitam. Notas em fila que cruzam a virada são decididas pelo `dhEmi` | Decidir o corte antes de 30/11 (seção 6). O runbook de rollback já existe (`runbooks/dps-layout-unsupported.md`) | S | **Sim** |
| 5 | XSD de produção | Não achamos o XSD de produção. A lib valida contra o de Produção Restrita 20261020. Se o de produção diferir, a nota falha localmente (`DPS_SCHEMA_VALIDATION_FAILED`) ou na Sefin | Quando sair: atualizar o fork, fixar commit novo em `api/package.json:92`, rodar `yarn test` e `yarn test:fiscal:integration` | M | **Sim** |
| 6 | `opSimpNac` ganha "4 - Optante Pendente" | `dps-builder.ts:365-370` só produz MEI, ME/EPP e não optante. Quem estiver "pendente" na Receita vira "não optante" na nota | Decidir se o cadastro da empresa passa a registrar "pendente"; hoje não existe esse estado. Depende de a Receita expor isso (pergunta aberta) | M | Não, enquanto não houver o estado |
| 7 | Simples: `regApIBSCBSSN` (0-1; 1/2/3), `cAtvSN`, `vReceitaBrutaSN`, `gTribSN` | Nada disso é montado (`regApTribSN` fica em `dps-builder.ts:432-440`). Se virarem obrigatórios para MEI/Simples, toda nota deles rejeita | Só planejar: precisa do XSD das releases 2/3 e da lib. Pedir confirmação do que é obrigatório | L | Não sabemos (ver perguntas) |
| 8 | `indFinal` volta; `indDest` e `dest` sobem para `infDPS` | Hoje `indDest` é fixo em `TomadorEhDestinatario`, dentro de `IBSCBS` (`dps-builder.ts:358`), e `indFinal` não é preenchido (limitação já documentada). O XSD 20261020 ainda tem `indDest` em `IBSCBS` (a lib valida assim), então isso parece ser de release posterior | Acompanhar as releases 2 e 3. Nova pergunta ao cliente: consumidor final? | M | Não (parece release 2/3) |
| 9 | `finNFSe` ganha 1=crédito e 2=débito; `tpNFSeDebito`, `tpNFSeCredito`, `gIBSCBSAjuste` | Sem data. A Corvo só emite `finNFSe=0` (`dps-builder.ts:356`) | Funcionalidade nova (nota de crédito/débito): spec própria | L | **Não**, pode esperar |
| 10 | `gPgtoVinc` (novo); `verCalcIBSCBS` na NFS-e | Não montamos `gPgtoVinc`. `verCalcIBSCBS`: nada na Corvo lê | Só quando houver XSD; avaliar se vai no DANFSe | M | Não |
| 11 | Grupo `imovel` reestruturado; locação (`gReeRepRes` some) | A lib recusa `imovel`/`gReeRepRes` no `nt009-r1`. A Corvo não preenche esses grupos hoje, então nada quebra; só bloqueia locação futura | Esperar a lib; ligado aos códigos 99.03 | M | Não |
| 12 | CNPJ alfanumérico | Já em produção desde 10/08/2026 e já tratado | Nada | - | - |
| 13 | Conciliação com a NFS-e autorizada | `reconcile.ts:52` lê `infNFSe.IBSCBS.totCIBS`; o parser da lib não mudou esse bloco no release 1 | Rodar com NFS-e real do layout novo; se `totCIBS` mudar, ajustar | S | Sim (teste) |
| 14 | Sincronização do portal | `portal-sync` só lê **eventos** (`parseEventoXml`, `portal-event.ts:39`). Sem impacto direto esperado no release 1 | Rodar um evento (cancelamento) na Produção Restrita | S | Sim (teste) |
| 15 | Docs | `limitations.md` ainda dizia que a NT 009 não era suportada; spec falava em V1.04.00 | Corrigido neste PR | S | - |

**Fixtures e testes.** O montador tem testes de XML contra os dois XSDs (`dps-builder.spec.ts`, `dps-layout.spec.ts`, `rtc-env.spec.ts`). Falta uma NFS-e **autorizada** do layout novo (para DANFSe e conciliação) e um teste de ponta a ponta na Produção Restrita (`api/test/fiscal-dps-emission.e2e-spec.ts` usa só transporte simulado).

### Os 5 itens do dia 1

1. **Decidir o corte de 01/12 e confirmar o que a Sefin aceita** (itens 4 e 5): S.
2. **Emitir de verdade na Produção Restrita com `nt009-r1`** (itens 3, 13 e 14) e guardar o XML autorizado: M.
3. **DANFSe e conciliação com NFS-e autorizada no layout novo** (itens 1 e 2): M.
4. **Atualizar o fork da lib para o XSD de produção** assim que sair (item 5): M.
5. **Ensaiar o rollback por variável de ambiente** (já existe; falta ensaio com o time): S.

## 6. Plano de virada proposto

**Chave de layout (já existe):** `FISCAL_DPS_LAYOUT` e `FISCAL_NT009_CUTOVER_AT`. Não precisamos de uma flag nova.

1. **Agora até 30/11 (Produção Restrita).** Subir um ambiente com `NFSE_SEFIN_ENVIRONMENT=restricted` e `FISCAL_DPS_LAYOUT=nt009-r1`. Emitir notas com o certificado real da empresa de teste: serviço comum de MEI, de Simples ME/EPP, de regime normal, um código 99.02 a 99.04, cancelamento e substituição. Guardar cada XML autorizado como fixture, gerar o DANFSe e conferir a conciliação.
2. **Antes de 30/11.** Com o resultado, escolher uma posição para a produção:
   - **A (mais segura):** manter `rtc-v1.01` fixo e adiar `FISCAL_NT009_CUTOVER_AT` para uma data futura. Só vale se a Sefin ainda aceitar o layout antigo depois de 30/11.
   - **B:** deixar `auto` com corte em `2026-12-01T00:00:00-03:00`. Só vale se o XSD de produção for compatível com o de 20261020.
3. **01/12.** Se B: emitir uma nota real logo após a meia-noite e acompanhar as rejeições (`corvo.fiscal.dps.validation.failed.total` e `DPS_SCHEMA_VALIDATION_FAILED`) na primeira hora.
4. **Rollback (sem deploy).** Definir `FISCAL_DPS_LAYOUT=rtc-v1.01` ou adiar `FISCAL_NT009_CUTOVER_AT` e reaplicar o ambiente à API e ao worker. Só ajuda se o layout antigo ainda for aceito; se não for, o caminho é corrigir à frente. Por isso a pergunta 1 abaixo é a mais importante.
5. **Notas que cruzam a virada.** O layout é escolhido pelo `dhEmi` de cada nota. Uma nota na fila com `dhEmi` de 30/11 reenviada em 01/12 segue no layout antigo e pode ser recusada. Combinar com o time esvaziar a fila antes da meia-noite de 30/11.

## 7. Perguntas abertas

1. **O layout antigo (NT 004 v2.0) continua aceito depois de 30/11?** Por quanto tempo? Decide entre A e B.
2. **Existe XSD de produção da NT 009?** É igual ao de Produção Restrita 20261020? Qual commit fixar no fork?
3. **Anexo VI V1.04.01 ou Anexo VII v1.03.00?** Qual é o vigente (divergência entre o Ato e a página RTC)?
4. **O que as releases 2 e 3 exigem do MEI/Simples?** `regApIBSCBSSN`, `cAtvSN`, `vReceitaBrutaSN` e `gTribSN` são obrigatórios? Desde quando?
5. **"Optante Pendente" (`opSimpNac=4`):** como a empresa entra nesse estado e como a Corvo fica sabendo?
6. **Aceitação por município:** todos os municípios que atendemos adotam a NT 009 em 01/12?
7. **Quando sai o cronograma formal?** Há risco de a data mudar?
8. **Notas de crédito e débito:** algum cliente pede? Se não, ficam fora do roteiro até haver data.
9. **Tolerância do grupo IBS/CBS** (orientação CGNFS-e de 07/08/2026, até 31/12/2026): vale também para o layout novo?
10. **Certificado A1 de teste ativo** para o ensaio da seção 6?
