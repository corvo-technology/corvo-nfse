# Schemas XSD da NF-e

Pacote vigente na data do spike: **PL_010h v1.03** (NT 2026.006 v1.00, NT 2026.008 v1.01 e
NT 2026.005 v1.00), publicado em 13/11/2026 no Portal Nacional da NF-e. Leiaute 4.00.

## Origem

- Lista oficial: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=BMPFMBoln3w=
  (seção "Esquemas XML", linha "Pacote de Liberação nº 010h v.1.03", em "VERSÕES OFICIAIS (em uso)").
- Arquivo oficial baixado em 2026-11-26: `PL_010h_v1.03.zip`, SHA-256
  `bcbf6b277f79a6983d69016dfe0430f09b8a191997a4706a24938acddc18dc81`.

O pacote oficial da 010h é um pacote de **diferenças**: traz só 10 arquivos (`leiauteNFe_v4.00.xsd`,
`nfe_v4.00.xsd`, `tiposBasico_v4.00.xsd`, `tiposBasico_v1.03.xsd`, `DFeTiposBasicos_v1.00.xsd`,
`xmldsig-core-schema_v1.01.xsd` e eventos `e110001`, `e110300`, `e412140`). Os demais arquivos
necessários (envio, consultas, eventos, inutilização, retornos) vêm do espelho
`nfephp-org/sped-nfe`, pasta `schemes/PL_010h` (branch master de 2026-11-23). Os arquivos que existem
nos dois lugares foram comparados e são idênticos, byte a byte, depois de normalizar as quebras de
linha (CRLF para LF).

Foram copiados só os 26 arquivos alcançados a partir dos XSDs raiz usados pela Fase 1 (`nfe`,
`enviNFe`, `consStatServ`, `consSitNFe`, `envEvento`, `envCCe`, `inutNFe` e os retornos).

## Atualizar

1. Ver na lista oficial se saiu um pacote novo.
2. Baixar o ZIP, conferir o SHA-256 e trocar os arquivos (mantendo LF).
3. Atualizar `SCHEMA_PACKAGE` em `schema-validator.ts`, a pasta e este arquivo.
4. Rodar `yarn jest src/infra/external/nfe/sefaz/schema-validator.spec.ts`.

## Algoritmos da assinatura

`xmldsig-core-schema_v1.01.xsd` fixa C14N inclusivo (`REC-xml-c14n-20010315`), `rsa-sha1` e `sha1`
(atributos `fixed`). Por isso o assinador usa SHA-1: é exigência do leiaute, não escolha nossa.
