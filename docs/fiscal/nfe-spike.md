# Spike da NF-e (PR 2/7)

**Resultado do spike: PENDENTE da execução do dono.** O código foi escrito e testado sem rede (SOAP
simulado, schemas oficiais, assinatura verificada). Nada foi enviado à SEFAZ, porque isso exige um
certificado A1 de uma empresa com Inscrição Estadual. Enquanto as tabelas abaixo não forem
preenchidas, a pilha de PRs não deve passar do PR 3.

Se o spike falhar, a pilha para e a seção 5.1 da spec é reaberta (ver "Se falhar").

## O que o dono precisa ter

1. O certificado A1 (arquivo `.pfx` ou `.p12`) de uma empresa do Simples Nacional **com Inscrição
   Estadual** que venda mercadoria, e a senha dele.
2. Em SP: a IE credenciada como emissora de NF-e e com acesso ao ambiente de homologação.
3. Para a SVRS: uma IE numa UF atendida por ela (AC, AL, AP, CE, DF, ES, PA, PB, PI, RJ, RN, RO, RR,
   SC, SE ou TO).
4. Node 24 e `yarn install` feito na pasta `api/`.

O certificado fica no seu computador, fora do repositório. Os scripts leem o caminho e a senha de
variáveis de ambiente na hora de rodar. Não grave a senha em arquivo versionado.

## Variáveis de ambiente

| Variável | Obrigatória | O que é |
|---|---|---|
| `NFE_SPIKE_PFX_PATH` | sim | Caminho do `.pfx` no seu computador. |
| `NFE_SPIKE_PFX_PASSWORD` | sim | Senha do `.pfx`. |
| `NFE_SPIKE_UF` | sim | UF da empresa (`SP` ou uma UF da SVRS, por exemplo `RJ`). |
| `NFE_SPIKE_IE` | só no `authorize` | Inscrição Estadual da empresa, só dígitos. |
| `NFE_SPIKE_CMUN` | só fora de SP | Código IBGE do município da empresa (7 dígitos). Em SP o padrão é 3550308. |
| `NFE_SPIKE_XMUN`, `NFE_SPIKE_CEP`, `NFE_SPIKE_XLGR`, `NFE_SPIKE_XNOME` | não | Nome do município, CEP (8 dígitos), rua e razão social. Tem padrão. |
| `NFE_SPIKE_NUMBER` | não | Número da nota (`nNF`), padrão 1. Troque a cada nota autorizada. |
| `NFE_SPIKE_SERIES` | não | Série, padrão 1. |
| `NFE_SPIKE_CSOSN` | não | `102` (padrão) ou `400`. |
| `NFE_SPIKE_NCM` | não | NCM do produto de teste, padrão `21011110`. Confirme com o contador. |
| `NFE_SPIKE_SCENARIO` | não | `reject-ncm` manda um NCM inexistente para provocar uma rejeição de propósito. |
| `NFE_SPIKE_DRY_RUN` | não | `1` monta, valida e assina, mas não envia nada. |

Os scripts só funcionam em homologação (`tpAmb=2`). Qualquer outro valor em `NFE_SPIKE_TP_AMB` faz o
script parar. Eles imprimem só cStat, xMotivo, protocolo, chave e tempos. Nunca imprimem a senha, o
PFX, a chave privada nem o XML.

## Comandos

Dentro da pasta `api/`:

```bash
# 1. Status do serviço (só transporte: mTLS + SOAP 1.2)
NFE_SPIKE_PFX_PATH=/caminho/empresa.pfx \
NFE_SPIKE_PFX_PASSWORD='...' \
NFE_SPIKE_UF=SP \
yarn ts-node -r tsconfig-paths/register scripts/nfe-spike-status.ts

# 2. Ensaio sem enviar (monta, valida no XSD e assina)
NFE_SPIKE_PFX_PATH=/caminho/empresa.pfx \
NFE_SPIKE_PFX_PASSWORD='...' \
NFE_SPIKE_UF=SP NFE_SPIKE_IE=123456789110 NFE_SPIKE_DRY_RUN=1 \
yarn ts-node -r tsconfig-paths/register scripts/nfe-spike-authorize.ts

# 3. Autorização de verdade (homologação)
NFE_SPIKE_PFX_PATH=/caminho/empresa.pfx \
NFE_SPIKE_PFX_PASSWORD='...' \
NFE_SPIKE_UF=SP NFE_SPIKE_IE=123456789110 NFE_SPIKE_NUMBER=1 \
yarn ts-node -r tsconfig-paths/register scripts/nfe-spike-authorize.ts
```

Repita os três passos com uma UF da SVRS (por exemplo `NFE_SPIKE_UF=RJ`, com a IE, o
`NFE_SPIKE_CMUN` e o `NFE_SPIKE_CEP` daquela empresa).

Sem certificado, só o passo 2 pode ser ensaiado, com um certificado de teste gerado na hora:
`yarn ts-node -r tsconfig-paths/register scripts/lib/make-dry-run-pfx.ts /tmp/dry.pfx`
(senha `dry-run-pass`, CNPJ de mentira). Foi assim que o ensaio foi feito neste PR.

## Como é o sucesso

| Passo | Saída esperada |
|---|---|
| Status | `cStat=107 xMotivo="Serviço em Operação" up=true`. Sai com código 0. |
| Ensaio | `XSD da NFe (estrutural): ok`, `XSD do enviNFe assinado: ok`, `DRY RUN: nada foi enviado.` |
| Autorização | `lote: cStat=104` (lote processado) e `nota: cStat=100 (authorized)` com `nProt` preenchido e `chNFe` igual à chave impressa. |

cStat que podem aparecer e o que significam:

| cStat | Significado | O que fazer |
|---|---|---|
| 107 | Serviço em operação. | Sucesso do status. |
| 108 / 109 | Serviço paralisado. | Tentar de novo mais tarde; não é falha nossa. |
| 104 | Lote processado (vem junto da resposta da nota). | Olhar o cStat da nota. |
| 100 | Autorizado o uso da NF-e. | Sucesso da autorização. |
| 110 / 301 / 302 / 303 | Uso denegado. | Anotar o código na tabela de denegação abaixo. |
| 203 | Emissor não habilitado. | A IE não está credenciada em homologação (item 2 acima). |
| 225 | Falha no schema do lote. | Bug nosso: o XSD local passou e a SEFAZ não. Anotar a mensagem completa. |
| 280 / 285 / 290 | Problema no certificado transmissor ou de assinatura. | Conferir a validade e a cadeia do certificado. |
| 297 | Assinatura difere do calculado. | Bug nosso na assinatura (C14N/SHA-1). Parar e reabrir a spec 5.1. |
| 539 / 204 | Duplicidade. | Troque `NFE_SPIKE_NUMBER`. |
| 778 | NCM inexistente. | Troque `NFE_SPIKE_NCM` (ou é o `reject-ncm` funcionando). |

Se o passo de status falhar com erro de certificado do servidor, a cadeia ICP-Brasil versionada não
cobre aquela SEFAZ: rode `scripts/update-icp-brasil-chain.sh` e tente de novo antes de concluir
que o mTLS falhou.

## Perguntas que o spike responde

Preencha depois de rodar (data, UF, resultado). Itens que dependem de PRs futuros ficam
`[pendente: PR4/PR5]`.

| # | Pergunta | SP | SVRS (UF: ___) |
|---|---|---|---|
| 1 | mTLS com o A1 funciona (status cStat 107)? | PENDENTE | PENDENTE |
| 2 | A cadeia ICP-Brasil versionada basta, sem `rejectUnauthorized: false`? | PENDENTE | PENDENTE |
| 3 | A assinatura (RSA-SHA1, SHA-1, C14N) é aceita? | PENDENTE | PENDENTE |
| 4 | cStat da autorização (esperado 100) | PENDENTE | PENDENTE |
| 5 | `PISOutr` e `COFINSOutr` com CST 49 zerados são aceitos? | PENDENTE | PENDENTE |
| 6 | Mesmo `nNF` com `cNF` novo é aceito depois de uma rejeição? (rode com `NFE_SPIKE_SCENARIO=reject-ncm` e depois sem, com o mesmo `NFE_SPIKE_NUMBER`) | PENDENTE | PENDENTE |
| 7 | A consulta pela chave devolve `procEventoNFe`? (o PR 5 já usa essa resposta para conciliar eventos; o roteiro está no runbook) | [pendente: rodar o runbook do PR5] | [pendente: rodar o runbook do PR5] |
| 8 | Quais cStat de denegação aparecem na prática? | [pendente: PR4/PR5] | [pendente: PR4/PR5] |
| 9 | Regra do dígito verificador da chave com CNPJ alfanumérico | [pendente: PR4/PR5] | [pendente: PR4/PR5] |
| 10 | As URLs de `endpoints.ts` respondem como esperado? | PENDENTE | PENDENTE |

## O que foi verificado neste PR, sem a SEFAZ

- **XSD**: pacote oficial **PL_010h v1.03** (13/11/2026) vendorizado em
  `api/src/infra/external/nfe/sefaz/schemas/PL_010h_v1.03/`. A origem, o SHA-256 e a nota sobre o
  pacote de diferenças estão em `schemas/README.md`. Uma NF-e mínima do Simples (CSOSN 102, PIS e
  COFINS CST 49 zerados), o `enviNFe` com a nota assinada, `consStatServ` e `consSitNFe` passam no
  XSD.
- **Biblioteca de XSD**: `xmllint-wasm` funcionou (valida em milissegundos e dá linha e mensagem).
  Não foi preciso o plano B (`libxmljs2`). Isso vale para o ambiente de teste local; a decisão final
  fica confirmada se o build de produção também passar (o `yarn build` copia os schemas para `dist`).
- **Assinatura**: o XSD oficial do XMLDSig (`xmldsig-core-schema_v1.01.xsd`) fixa C14N inclusivo
  (`REC-xml-c14n-20010315`), `rsa-sha1` e `sha1`. É por isso que usamos SHA-1: é exigência do
  leiaute. A assinatura gerada verifica com `xml-crypto`, falha se um byte do `infNFe`, `infEvento`
  ou `infInut` mudar, e o XML assinado passa no XSD. **A aceitação pela SEFAZ está pendente** (item 3).
- **Chave de acesso**: DV módulo 11 conferido com duas chaves de amostra do `sped-nfe` e com o
  exemplo do MOC. `cNF` nunca é igual ao `nNF`. `AAMM` sai do `dhEmi` no fuso da UF.
- **CNPJ alfanumérico**: a NT 2026.004 v1.01 (publicada em 08/06/2026) só diz que a chave aceita
  letras; **ela não descreve a regra do DV**. O código usa valor = código ASCII − 48 (a mesma regra
  do DV do CNPJ da Receita). **Não confirmado** com a SEFAZ (item 9).
- **Transporte**: SOAP 1.2 com mTLS (undici), erros tipados (`ok`, `uncertain`, `unavailable`) e
  teste de que nada de CPF, chave privada ou XML vai para o log. Tudo com `MockAgent`, sem rede.
- **URLs**: vieram do espelho `sped-nfe` (`storage/wsnfe_4.00_mod55.xml`, 23/11/2026) e **não foram
  testadas** contra o serviço real (item 10).
- **Cadeia ICP-Brasil**: baixada do pacote oficial do ITI (186 certificados, SHA-256 em
  `certs/README.md`). Se ela cobre os servidores da SEFAZ de SP e da SVRS é parte do item 2.

## Se falhar

Parar a pilha e reabrir a spec 5.1 antes do PR 3. Casos típicos e o plano:

- **mTLS** (status não passa): conferir a cadeia; testar `ca` com a cadeia do servidor
  (`openssl s_client -showcerts`).
- **Assinatura recusada (297)**: comparar a canonicalização com a de uma lib de referência (nfewizard-io ou
  sped-nfe) usando o mesmo XML.
- **XSD**: se o `xmllint-wasm` der falso positivo ou negativo, trocar por `libxmljs2` e registrar
  aqui.
- **Rejeição inesperada**: anotar cStat e xMotivo na tabela. Não tente de novo com o mesmo `nNF`
  antes de ler o item 6.
