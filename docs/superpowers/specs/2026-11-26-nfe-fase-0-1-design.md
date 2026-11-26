# NF-e no Corvo: Fase 0 (fundação) e Fase 1 (MVP), desenho

Data: 2026-11-26. Status: proposta, só documento (nenhum código).

Legenda: **[verificado]** = li a fonte citada. **[não verificado]** = vem de memória ou de fonte secundária; conferir antes de implementar.

## 1. Intenção e porquê

Hoje o Corvo emite só NFS-e. Quem vende produto precisa de NF-e (modelo 55) e, mais tarde, de NFC-e (modelo 65). Quase tudo que uma NF-e exige já existe aqui: tenants, empresas, membros, permissões, auditoria, certificado A1 cifrado, fila de emissão com retry, idempotência, conciliação, revisão manual, créditos, armazenamento de XML/PDF, e-mail ao cliente, pacote do contador, webhooks (outbox), chaves de API, contrato OpenAPI, ferramentas MCP e conectores de venda.

A ideia é **somar um novo tipo de documento sem reescrever a plataforma**. Cada tipo de documento e cada autoridade (SEFAZ-SP, SVRS, mais tarde SVC) passa a ser um adaptador. O código é próprio e aberto (AGPL).

## 2. Objetivos

Fase 0, fundação (sem NF-e visível ao cliente):
- Criar a dimensão "tipo de documento" (`nfse | nfe | nfce`) e as portas compartilhadas da seção 6.
- Generalizar créditos, armazenamento, webhooks, outbox, permissões e o disjuntor do portal para aceitar qualquer tipo.
- Nada muda para quem usa NFS-e: mesma API, mesmos webhooks, mesmos caminhos no S3.

Fase 1, NF-e MVP (mesma lista do concorrente enwp):
1. **Validar sem enviar**: gera o XML e confere no XSD. Não assina, não gasta número, não chama a SEFAZ.
2. **Emitir**: assina com o A1 e envia. Resultado: autorizada, rejeitada ou denegada.
3. **Consultar pela chave**: recupera resposta perdida. Guarda o `nfeProc` com o protocolo, dispara o webhook e é idempotente.
4. **Cancelar** com justificativa.
5. **Carta de correção (CC-e)**.
6. **Inutilizar faixa** de números.
7. **XML autorizado** (`nfeProc`) e **DANFE em PDF**.
8. **Erros com tipo claro**: "comunicação" (o Corvo tenta de novo ou consulta) vs "validação/rejeição" (o cliente corrige os dados).

## 3. Fora do escopo (anti-objetivos)

- **Não quebrar a NFS-e.** Nenhuma rota, evento, coluna ou caminho de S3 da NFS-e muda de nome ou de formato.
- **Não calcular imposto.** O cliente informa CSOSN, CFOP, NCM etc. por item. O Corvo só valida formato e coerência; não calcula ICMS, ST nem DIFAL.
- Regime normal (CRT 3), CSOSN além de 102 e 400, ST, importação/exportação, devolução, nota complementar e ajuste (só `finNFe=1`, normal).
- NFC-e (Fase 3) e contingência SVC-AN/SVC-RS/EPEC (Fase 4). O desenho deixa espaço para as duas, sem implementá-las.
- Manifestação do destinatário e distribuição DF-e.
- Catálogo de produtos completo. No MVP os itens vêm na própria requisição (seção 8.2).
- UFs fora de SP e da SVRS.

## 4. Restrições

- Layout 4.00 da NF-e, MOC 7.0 e notas técnicas vigentes. Portal: https://www.nfe.fazenda.gov.br (o fetch direto falhou por loop de redirecionamento, então os links oficiais abaixo vieram da busca).
- Reforma tributária (NT 2025.002, grupos IBS/CBS):
  - Lista de NTs: https://hom.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D. Ela mostra versões da v1.00 (28/03/2025) à v1.31 (11/11/2025). Há menções a v1.36 (30/04/2026) e v1.40. **[não verificado qual vale]**
  - Fontes secundárias dizem que a obrigação para CRT 1/2/4 em produção começa em 04/01/2027 (https://www.contabeis.com.br/artigos/76943/nf-e-novas-regras-e-cronogramas-para-ibs-e-cbs-em-2026-2027/). **[não verificado no texto da NT]**
  - Decisão: os campos IBS/CBS ficam modelados (coluna/JSON por item e no total) e o builder sabe escrevê-los. Na Fase 1 eles não são exigidos de quem é do Simples. Uma flag por data liga a exigência sem migração.
- Ambientes: a empresa no Corvo já pertence a um ambiente (`nfse_companies.environment`, `test | live`). `test` vira `tpAmb=2` (homologação) e `live` vira `tpAmb=1`. A Fase 1 vai só até homologação. Produção abre depois do roteiro da seção 10.3.
- Mapa de autorizadores do modelo 55 **[verificado só no espelho do sped-nfe, `storage/autorizadores.json`]**:
  - SEFAZ própria: AM, BA, GO, MG, MS, MT, PE, PR, RS, SP.
  - SVAN: MA.
  - SVRS: AC, AL, AP, CE, DF, ES, PA, PB, PI, RJ, RN, RO, RR, SC, SE, TO.
  - A Fase 1 cobre SP mais as 16 UFs da SVRS.
- A SEFAZ usa certificados de servidor da cadeia ICP-Brasil, que o Node não confia por padrão **[não verificado por UF]**. A cadeia vai junto, versionada no código. `rejectUnauthorized: false` nunca entra.
- Toda a infraestrutura atual se mantém: NestJS, TypeORM com RLS por tenant, BullMQ, outbox e S3.

## 5. Abordagens consideradas

### 5.1 Biblioteca SOAP/XML/assinatura

**A. Fork do `nfewizard-io`**, no mesmo padrão do `open-nfse`: repositório `corvo-technology/...` instalado por `github:...#sha`, ver `api/package.json`.

Fatos verificados em https://github.com/nfewizard-org/nfewizard-io e com `npm view`:
- Licença GPL-3.0 (LICENSE.txt e package.json). É compatível com AGPL-3.0: a seção 13 da GPLv3 permite combinar as duas (https://www.gnu.org/licenses/gpl-3.0.html).
- Versão 2.0.0, último commit em 2026-11-08, 330 estrelas, 17 contribuidores.
- Monorepo com os pacotes nfe, nfce, danfe, cte, nfse, shared e types. Node 20 ou mais.
- Cobre autorização, consulta, inutilização, eventos (cancelamento, CC-e, EPEC), DF-e, contingência e DANFE. O README cita a NT 2025.002 v1.35.

Contras:
- O `@nfewizard/shared` puxa **libxmljs2 (módulo nativo)**, `soap`, `easy-soap-request`, axios **e** node-fetch, xml2js **e** xml-js, winston, nodemailer, `xsd-schema-validator` (Java) e `pem`. É peso e superfície de ataque, e o build nativo complica o Docker.
- O README diz "testado apenas para São Paulo". A SVRS não aparece documentada.
- Logging e e-mail ficam dentro da biblioteca. Para nós, isso é responsabilidade da plataforma, não do adaptador.
- Não sei se a biblioteca permite gravar a chave e o XML assinado **antes** do envio, que é o ponto central da nossa conciliação. **[não verificado]**

**B. Camada própria, fina**, em `api/src/infra/external/nfe/sefaz/`, sem nada do Nest dentro, para poder virar o pacote `corvo-technology/open-nfe` depois:
- O núcleo são 6 serviços SOAP 1.2 (autorização, retorno de autorização, consulta de protocolo, status, evento e inutilização), um builder de XML, assinatura XMLDSig (`xml-crypto`, já usado no ecossistema) e o mTLS com o PFX do A1, que já fazemos na NFS-e.
- Contras: mais código nosso; os detalhes de UF a gente aprende apanhando.

**C. Usar o `nfewizard-io` como dependência direta, sem fork.** Descartado: não temos controle de versão nem dá para corrigir rápido, e herdamos todas as dependências da opção A.

**Recomendação: B.** Usamos o nfewizard-io e o sped-nfe (https://github.com/nfephp-org/sped-nfe, `storage/wsnfe_4.00_mod55.xml`) como **referência** de endpoints, códigos cStat e particularidades de cada UF. As licenças permitem copiar trechos pontuais com atribuição: o nfewizard é GPL-3.0, e o sped-nfe declara LGPL-3.0-or-later/GPL-3.0-or-later/MIT no composer.json **[a combinação de licenças do sped-nfe é ambígua, não verificado qual vale]**.

Por que B:
1. O que conta mais é a ordem "gravar antes de enviar" e o tipo de cada erro. Com código nosso, isso fica do jeito que a conciliação precisa.
2. Sem módulo nativo e sem Java.
3. A superfície é pequena e estável: o layout 4.00 existe desde 2017.
4. As mesmas portas atendem NFC-e e contingência depois.

Se a camada B passar de ~3 semanas sem autorizar em homologação, reavaliamos a opção A só para a parte SOAP.

### 5.2 Modelo de dados

**A. Tabela única** `nfse_invoices` com `document_type` e colunas ou JSON por tipo.
- A favor: listagem e visão geral unificadas sem esforço.
- Contra: a tabela e o agregado `Invoice` são NFS-e por todo lado (`dps_id`, `nfse_number`, `service_snapshot`, substituição, `portal_flag`, pipeline de ISS). A NF-e tem itens, eventos sequenciais (CC-e), estado "denegada" e inutilização. Seriam dezenas de colunas nulas, mais risco de regressão nos índices, no cursor e no RLS da NFS-e.

**B. Tabelas próprias para NF-e** mais portas compartilhadas, referenciando o documento por `(document_type, document_id)`.
- A favor: a NFS-e fica intacta; a NF-e ganha um modelo limpo.
- Contra: a listagem unificada precisa de uma view.

**C. Reescrever tudo como `fiscal_documents` genérico e migrar a NFS-e.** Descartado: é risco alto sem ganho para o cliente agora.

**Recomendação: B**, com uma view de leitura `fiscal_documents_v` (`UNION ALL` das duas tabelas, só colunas comuns) para a visão geral e o painel. A NFS-e pode migrar para as portas aos poucos (seção 6.6), sem precisar mudar de tabela.

## 6. Arquitetura: portas, adaptadores e SOLID

A regra geral: a camada de aplicação depende só de portas (interfaces). Os adaptadores de infra implementam as portas e o NestJS liga uma coisa à outra. Somar NFC-e, uma UF nova ou contingência significa somar um adaptador ou uma linha de configuração, sem mexer no que já funciona.

Pragmatismo (YAGNI): só criamos uma abstração quando uma segunda implementação está à vista. Dá para ver nesta tabela:

| Porta | 1ª implementação | 2ª implementação à vista |
|---|---|---|
| `DocumentNumbering` | NF-e (série/nNF) | NFC-e; DPS da NFS-e |
| `AuthorityEndpointResolver` | SP, SVRS | SVC-AN/RS (Fase 4), outras UFs |
| `DocumentRenderer` | DANFE | DANFSe (já existe), DANFCE |
| `FiscalDocumentGateway` | NF-e | NFC-e, NFS-e (strangler) |
| `XmlSigner`, `SchemaValidator` | NF-e | NFC-e, eventos |
| `TaxValidator` | Simples 102/400 | outros CSOSN, regime normal |

Fica **sem** porta nova o que só tem um uso: e-mail, pacote do contador e outbox já são genéricos o bastante.

### 6.1 Portas (domínio), em `api/src/modules/fiscal-core/domain/ports/`

```ts
export type DocumentType = 'nfse' | 'nfe' | 'nfce';
export interface DocumentRef { type: DocumentType; id: string; tenantId: string; environment: ExecutionEnvironment }

// Erros: duas famílias, nunca misturadas
export type GatewayOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'rejected'; code: string; message: string; hint?: string }   // dados errados: o cliente corrige
  | { kind: 'denied'; code: string; message: string }                   // denegada (só NF-e/NFC-e)
  | { kind: 'uncertain'; reason: 'timeout' | 'network' | 'server' }     // comunicação: o Corvo consulta/tenta de novo
  | { kind: 'unavailable'; retryAfterMs?: number };                     // serviço fora; nada foi enviado

// Segregação de interfaces: cada capacidade é uma porta; um tipo implementa só o que suporta
export interface IssueCapability<D> { issue(doc: D, ctx: SigningContext): Promise<GatewayOutcome<Authorization>> }
export interface ConsultCapability { consultByKey(key: string, ctx: SigningContext): Promise<GatewayOutcome<ConsultResult>> }
export interface CancelCapability { cancel(req: CancelRequest, ctx: SigningContext): Promise<GatewayOutcome<EventReceipt>> }
export interface CorrectCapability { correct(req: CorrectionRequest, ctx: SigningContext): Promise<GatewayOutcome<EventReceipt>> }
export interface InutilizeCapability { inutilize(req: InutilizeRequest, ctx: SigningContext): Promise<GatewayOutcome<EventReceipt>> }
export interface ServiceStatusCapability { status(target: AuthorityTarget): Promise<GatewayOutcome<{ up: boolean }>> }

export interface FiscalDocumentGateway<D> {
  readonly type: DocumentType;
  readonly issuer: IssueCapability<D>;
  readonly consult: ConsultCapability;
  readonly cancel?: CancelCapability;        // NFS-e tem, NF-e tem
  readonly correct?: CorrectCapability;      // NF-e sim; NFS-e e NFC-e não
  readonly inutilize?: InutilizeCapability;  // NF-e/NFC-e
  readonly serviceStatus?: ServiceStatusCapability;
}

export interface DocumentNumbering {
  /** Reserva atômica do próximo número de (empresa, modelo, série). Nunca volta. */
  reserveNext(scope: NumberingScope): Promise<{ series: number; number: number }>;
  raiseTo(scope: NumberingScope, lastUsed: number): Promise<void>;
}
export interface NumberingScope { companyId: string; tenantId: string; environment: ExecutionEnvironment; model: 55 | 65; series: number }

export interface AuthorityEndpointResolver {
  /** Dados, não código: UF × ambiente × modelo × tpEmis × serviço -> URL + versão. */
  resolve(q: { uf: Uf; tpAmb: 1 | 2; model: 55 | 65; tpEmis: TpEmis; service: SefazService }): AuthorityEndpoint;
}

export interface XmlSigner { sign(xml: string, referenceTag: 'infNFe' | 'infEvento' | 'infInut', cert: LoadedCertificate): string }
export interface SchemaValidator { validate(xml: string, schema: SchemaId): { ok: true } | { ok: false; errors: SchemaIssue[] } }
export interface TaxValidator<D> { validate(doc: D, profile: CompanyFiscalSnapshot): ValidationIssue[] }   // não calcula, só confere
export interface DocumentRenderer { readonly type: DocumentType; render(authorizedXml: string, opts: RenderOptions): Promise<Buffer> }
```

`SigningContext` leva o certificado já decifrado (`LoadedCertificate`, só em memória), o `tpAmb` e o alvo resolvido. As portas nunca recebem PFX cru nem senha.

### 6.2 Estratégia + registro por tipo e por autoridade

O padrão que já existe aqui se repete:
- `ConnectorRegistry` (`modules/integrations/domain/connector-registry.ts`): cada conector se registra no `onModuleInit`.
- `NfseProviderFactory`: escolhe o provedor real ou o simulado pelo ambiente.

Novo, em `fiscal-core/application/`:

```ts
@Injectable()
export class FiscalDocumentRegistry {           // espelha ConnectorRegistry
  private readonly gateways = new Map<DocumentType, FiscalDocumentGateway<unknown>>();
  register(g: FiscalDocumentGateway<unknown>): void { /* erro se duplicado */ }
  get<D>(type: DocumentType): FiscalDocumentGateway<D> { /* erro claro se ausente */ }
}
```

- Cada módulo de tipo (`NfeModule`, mais tarde `NfceModule`) registra o próprio gateway no `onModuleInit`, igual aos conectores.
- O simulado (`FakeNfeGateway`) segue a regra do `NfseProviderFactory`: com `NFE_TEST_PROVIDER=fake`, o ambiente `test` usa o simulado.
- A **autoridade é configuração**, não `if (uf === 'SP')`. O arquivo `infra/external/nfe/sefaz/endpoints.ts` é uma tabela tipada: `{ uf -> autorizador }` e `{ autorizador × tpAmb × serviço -> url, versão, soapAction }`.
  - Um teste confere que as 27 UFs têm entrada e que toda URL é `https`.
  - Somar SVC-AN/SVC-RS é somar linhas com `tpEmis` 6/7.
  - Uma UF fora do escopo devolve `UNSUPPORTED_UF` antes de qualquer envio.

### 6.3 Fluxo de emissão (Template Method / pipeline)

Um único `EmissionPipeline<D>` em `fiscal-core/application/` define a ordem. Os passos que mudam por tipo entram por injeção (aberto/fechado):

```
reservar crédito → validar (cadeia) → numerar → montar XML → assinar → GRAVAR (chave + XML assinado)
  → enviar → interpretar resultado → [conciliar por chave se incerto] → guardar nfeProc → PDF → notificar
```

```ts
export interface EmissionSteps<D> {
  validators: PreSendValidator<D>[];             // Chain of Responsibility: lista ordenada, junta todos os erros
  build(doc: D, n: { series: number; number: number }): BuiltDocument;  // usa o Builder
  persistBeforeSend(doc: D, built: SignedDocument): Promise<void>;      // write-ahead
  onAuthorized(doc: D, auth: Authorization): Promise<void>;
}
```

Os efeitos colaterais continuam onde já estão: outbox, `InvoiceWebhookPublisher` (generalizado para `FiscalWebhookPublisher`), crédito e e-mail. O pipeline chama esses efeitos pelas portas.

### 6.4 Builder, validações e máquina de estados

- `NfeXmlBuilder` (fluente, imutável) monta `infNFe` grupo por grupo: `ide`, `emit`, `dest`, `det[]`, `total`, `transp`, `pag`, `infAdic`, `infRespTec`, e `IBSCBS` quando a flag por data mandar. Cada grupo é uma função pura testada com fixture.
- Validações antes do envio são uma lista de `PreSendValidator`: CNPJ/CPF, IE do destinatário vs `indIEDest`, NCM com 8 dígitos, CFOP coerente com `idDest`, CSOSN permitido, soma dos itens = total, XSD. A lista **junta todos** os problemas e devolve todos de uma vez, sem parar no primeiro.
- Cada tipo tem uma máquina de estados própria: um `VALID_TRANSITIONS` por tipo, como o atual `invoice-status.ts`. A NFS-e mantém a dela. A da NF-e está na seção 8.3.

### 6.5 Estrutura de pastas alvo

```
api/src/modules/fiscal-core/            # Fase 0: genérico, sem nada de NFS-e/NF-e
  domain/ports/*.ts                     # portas da 6.1
  domain/document-type.ts, gateway-outcome.ts, credit-price.ts
  application/fiscal-document.registry.ts, emission-pipeline.ts, fiscal-webhook.publisher.ts
  testing/gateway-contract.suite.ts     # suíte de contrato (6.7)
api/src/modules/nfe/                    # Fase 1
  domain/nfe-document.ts, nfe-status.ts, access-key.ts, nfe-item.ts, validators/*.ts
  application/nfe-emission.steps.ts, nfe-consult|cancel|correct|inutilize.service.ts
  http/nfe.controller.ts, nfe.dto.ts
  infra/*.orm-entity.ts, typeorm-*.repository.ts, danfe/ (renderer)
api/src/infra/external/nfe/sefaz/       # adaptador SEFAZ, sem Nest
  endpoints.ts, soap-client.ts, xml-signer.ts, schema-validator.ts, cstat.ts, schemas/ (XSD oficiais)
  nfe-gateway.ts, fake-nfe.gateway.ts
api/src/modules/invoice/                # NFS-e: intacto na Fase 0, adapta-se aos poucos
```

Cada arquivo tem uma responsabilidade. O domínio não importa nada de `infra/`, e o `fiscal-core` não importa `invoice/` nem `nfe/`. Um teste de fronteira, como o `persistence-boundaries.spec.ts` que já existe, garante as duas regras.

### 6.6 NFS-e entra nas portas aos poucos (strangler)

1. Fase 0: `NfseGatewayAdapter` embrulha o `FiscalProvider` atual (`nfse-fiscal-provider.ts`), sem mudar comportamento, e se registra no `FiscalDocumentRegistry`. O `NfseWorkflowService` continua como está.
2. Os efeitos compartilhados passam a usar as portas novas: crédito por `DocumentRef`, publisher de webhook e storage. Cada troca vai num PR pequeno, com os testes atuais da NFS-e como rede de proteção.
3. Só quando a NF-e estiver estável em produção avaliamos mover o `NfseWorkflowService` para o `EmissionPipeline`. Se não houver ganho, ele fica como está. A API pública `/v1/invoices` não muda em nenhum passo.

### 6.7 Testes de contrato (substituição de Liskov)

`gateway-contract.suite.ts` exporta `describeGatewayContract(name, makeGateway, fixtures)` e roda contra cada adaptador: `FakeNfeGateway`, `NfeGateway` com o SOAP simulado por fixtures, `NfseGatewayAdapter` e `FakeNfseProvider`. A suíte garante:
- timeout vira `uncertain`, nunca `rejected`;
- consultar duas vezes dá o mesmo resultado;
- um cStat de rejeição vira `rejected` com código;
- denegação vira `denied`;
- nenhum adaptador lança exceção para um resultado de negócio.

## 7. Desenho da Fase 0 (fundação)

1. **Tipo de documento.** `DocumentType` e `DocumentRef` no `fiscal-core`.
2. **Créditos e preço por tipo.**
   - Nova tabela `document_credit_prices (document_type pk, credits int, updated_at)`, com a semente `nfse=1, nfe=1, nfce=1`.
   - Mudar o preço é um `UPDATE` (ou tela no admin da plataforma), sem migração.
   - `credit_transactions` ganha `reserved_document_type` (padrão `'nfse'`). `reserveCredit` passa a reservar `credits` do tipo, em vez do `-1` fixo de `invoice-lifecycle.service.ts`.
   - Cobra só a NF-e autorizada. Rejeitada, denegada, eventos (cancelamento, CC-e) e inutilização devolvem a reserva ou não cobram. A cota do plano (`usage.reserve`) conta NF-e igual à NFS-e.
3. **Armazenamento.**
   - `IDocumentStorage` ganha métodos por `DocumentRef` e nome de arquivo.
   - A NFS-e mantém `{tenant}/{env}/invoices/{id}/invoice.{xml|pdf}`.
   - A NF-e usa `{tenant}/{env}/nfe/{id}/nfe-proc.xml`, `.../danfe.pdf`, `.../events/{tpEvento}-{nSeq}.xml` e `{tenant}/{env}/nfe-inutilizacoes/{id}.xml`.
4. **Webhooks.**
   - Eventos novos com o mesmo envelope: `nfe.document.authorized`, `.rejected`, `.denied`, `.failed`, `.reconciliation_required`, `.manual_review`, `.documents_ready`, `.email_sent`, `.email_failed`, `.cancelled`, `.cancellation_rejected`, `.corrected`, e `nfe.inutilization.completed` / `.rejected`.
   - O envelope ganha `document_type`. A lista de entregas aceita o filtro `document_id`; `invoice_id` continua funcionando.
5. **Outbox.** Tipos de mensagem `nfe.emit`, `nfe.reconcile`, `nfe.cancel`, `nfe.correct`, `nfe.inutilize`, `nfe.prepare_documents`, no mesmo `OutboxHandlerRegistry`.
6. **Disjuntor.** O `FiscalPortalBreaker` passa a ter chave por autoridade (`nfse-sefin`, `nfe-sp-2`, `nfe-svrs-2`...). Uma SEFAZ fora do ar não trava a outra. `GET /v1/fiscal-portal/status` ganha os itens novos sem remover o atual.
7. **Permissões.** Entram `nfe.documents.view`, `nfe.documents.issue` e `nfe.documents.manage` (cancelar, CC-e, inutilizar). Uma migração dá essas permissões aos papéis que já têm as equivalentes da NFS-e.
8. **Empresa.**
   - Nova tabela `company_nfe_settings`: `company_id pk`, `state_registration` (IE, validada por UF), `crt` (1 ou 4 na Fase 1), `default_series`, `enabled_at`.
   - Também ganha `nfce_csc_id` e `nfce_csc_encrypted` (vazios até a Fase 3) e `contingency_mode` (`none`; Fase 4).
   - O endereço completo da empresa (logradouro, número, bairro, CEP, código IBGE) passa a ser obrigatório para NF-e. Hoje é opcional.
9. **Liberação.** A flag `nfe_enabled` por tenant (admin da plataforma) esconde rotas, telas e ferramentas MCP até a liberação.
10. **Critério de pronto.** Todos os testes atuais da NFS-e passam sem alteração; o snapshot do OpenAPI de `/v1/invoices` não muda; a suíte de contrato roda contra os adaptadores da NFS-e.

## 8. Desenho da Fase 1 (NF-e MVP)

### 8.1 Tabelas

- `nfe_documents`: `id`, `tenant_id`, `company_id`, `environment`, `model` (55), `series`, `number`, `access_key` (char 44, único por ambiente), `c_nf`, `tp_emis` (1), `issued_at` (dhEmi), `nat_op`, `id_dest`, `ind_final`, `ind_pres`, `status`, `c_stat`, `x_motivo`, `protocol`, `authorized_at`, `recipient` (jsonb), `totals` (jsonb), `payment` (jsonb), `transport` (jsonb, `modFrete=9` padrão), `additional_info`, `external_id`, `idempotency_key`, `request_hash`, `last_error_*`, `documents_ready_at`, campos de e-mail, `cancel_*` e `created/updated_at`.
  - RLS por tenant, como `nfse_invoices`.
- `nfe_document_items`: `n_item`, `code`, `gtin` (ou `SEM GTIN`), `description`, `ncm`, `cest`, `cfop`, `unit`, `quantity`, `unit_price`, `total`, `discount`, `origin`, `csosn`, `ibs_cbs` (jsonb, opcional).
- `nfe_document_events`: `tp_evento` (110111 cancelamento, 110110 CC-e), `n_seq`, `status`, `protocol`, `text` e o caminho do XML.
- `nfe_number_sequences`: pk `(company_id, model, series)`, `current_number`. A empresa já fixa o ambiente.
- `nfe_inutilizations`: `company_id`, `model`, `series`, `start`, `end`, `justification`, `status`, `protocol`.

### 8.2 Entrada (itens) e destinatário

No MVP os itens vêm inline. Um "produto favorito", no estilo do `service-favorites`, fica para a Fase 2. O destinatário exige documento, nome e endereço completo com código IBGE. `indIEDest` é 1, 2 ou 9; quando é 1, a IE é obrigatória. O destinatário fica salvo no diretório de clientes que já existe. Pagamento: `tPag` e valor. Frete: `modFrete=9` por padrão.

Em homologação, o `dest/xNome` precisa ser o texto fixo "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL". O Corvo troca o nome sozinho **[não verificado; regra conhecida do MOC]**.

### 8.3 Estados

```
queued → processing → authorized | rejected | denied | retry_pending | reconciliation_required
retry_pending → processing
reconciliation_required → authorized | rejected | denied | manual_review
manual_review → reconciliation_required | authorized | rejected
authorized → cancelling → cancelled | authorized
rejected → queued (reenviar corrigida, mesmo número) | discarded (número vai para inutilização)
denied, cancelled, discarded: finais
```

- **Denegada**: o número foi usado e o XML denegado é guardado. Não dá para cancelar. Não cobra.
- **Rejeitada**: o número não foi usado na SEFAZ. O cliente corrige e reenvia com o mesmo número, ou descarta. O número descartado entra numa lista "a inutilizar"; o usuário pode inutilizar a faixa com um clique. **[não verificado: confirmar no MOC que o número de uma nota rejeitada pode ser reaproveitado]**

### 8.4 Chave de acesso

44 dígitos: `cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)`. O DV usa módulo 11 com pesos de 2 a 9 **[não verificado no MOC; estrutura conhecida]**.

O `cNF` sai aleatório de `crypto.randomInt` e nunca é igual ao `nNF`. A rejeição 897 é a regra B03-10 da NT 2019.001, conferida só em resumo de terceiros: https://www.econeteditora.com.br/links_pagina_inicial/sped/nfe/nfe_notas_tecnicas/2019/nota_tecnica_001_2019.pdf.

A chave é **calculada e gravada antes do envio**. É isso que torna a conciliação simples.

### 8.5 Operações

- **Validar** (`POST /v1/nfe/validate`): monta o XML com o número de prévia (sem reservar) e uma `Signature` só estrutural, e roda o XSD e a cadeia de validadores. Devolve a lista de problemas, mais o XML de prévia se pedido. Não chama a SEFAZ, não cobra, não grava.
- **Emitir** (`POST /v1/nfe`, idempotente por `Idempotency-Key`):
  1. Grava `queued` e reserva o crédito. Um job do outbox numera, monta, assina e **grava a chave e o XML assinado**.
  2. Envia com `indSinc=1` e uma nota por lote.
  3. Se a SEFAZ responder 103 (lote recebido), consulta o recibo até ter o resultado.
  4. cStat 100: autoriza, monta o `nfeProc` (NFe + protRetorno) e guarda.
  5. Rejeição: `rejected`, com código, mensagem e dica (a tabela `cstat.ts` traz as orientações, como a `rejection-guidance.ts` da NFS-e).
  6. Denegação (110, 301, 302 **[não verificado]**): `denied`.
  7. Timeout ou erro de rede depois do envio: `reconciliation_required`, e o caminho segue para a consulta pela chave.
  8. Duplicidade (204): consulta pela chave e adota o protocolo encontrado.
- **Consultar pela chave** (`POST /v1/nfe/{id}/sync`, também usado pelo job de conciliação):
  - Chama `NfeConsultaProtocolo4`. Se estiver autorizada, monta o `nfeProc`, salva, dispara `authorized` uma única vez (a transição de estado é o trinco) e confirma o crédito.
  - Se não estiver na base (217 **[não verificado]**) depois do limite de incerteza, reenvia o **mesmo XML assinado**; a mesma chave nunca duplica.
  - As tentativas automáticas seguem o mesmo `reconciliationDelayMs` (2, 4, 8, 16 e 30 min) e depois caem em revisão manual, como na NFS-e.
- **Cancelar** (`POST /v1/nfe/{id}/cancel`): justificativa de 15 a 255 caracteres. Evento 110111 com `nProt`. O prazo legal padrão é de 24h **[não verificado; depende da UF]**. Fora do prazo, o Corvo mostra a rejeição da SEFAZ como ela vier, sem bloquear antes.
- **CC-e** (`POST /v1/nfe/{id}/corrections`): evento 110110 com `nSeqEvento` incremental. A correção mais recente substitui as anteriores. Limites conhecidos: até 20 por nota, mínimo de 15 caracteres **[não verificado]**. O texto de `xCondUso` vai fixo no builder.
- **Inutilizar** (`POST /v1/nfe/inutilizations`): empresa, série, faixa e justificativa. O Corvo recusa a faixa se houver nota não rejeitada nela.
- **Arquivos**: `GET /v1/nfe/{id}/xml` (o `nfeProc`), `GET /v1/nfe/{id}/pdf` (DANFE), `GET /v1/nfe/{id}/events` e `POST /v1/nfe/{id}/download-url`, reusando as URLs assinadas.

### 8.6 API, MCP e telas

- **Rotas novas em `/v1/nfe`.** Não reusamos `/v1/invoices` com um campo de tipo, porque o corpo, as operações (CC-e, inutilização) e os estados são diferentes. Misturar tudo deixaria o SDK confuso e arriscaria os `operationId`s atuais.
  - Os novos `operationId`s entram em `public-operations.ts` com a tag `NF-e`: `nfe_validate`, `nfe_create`, `nfe_list`, `nfe_get`, `nfe_sync`, `nfe_cancel`, `nfe_correct`, `nfe_xml`, `nfe_pdf`, `nfe_events`, `nfe_downloadUrl`, `nfeInutilizations_create`, `nfeInutilizations_list`.
  - `/v1/invoices` não muda.
- **Ferramentas MCP**: `nfe_validate`, `nfe_issue`, `nfe_get`, `nfe_list`, `nfe_query` (consulta SEFAZ), `nfe_cancel`, `nfe_correct`, `nfe_inutilize`, `nfe_get_download_url`. Respeitam a flag e as permissões.
- **Web**: uma seção "NF-e" no painel (lista, detalhe com linha do tempo de eventos e formulário de emissão com itens). A visão geral lê da `fiscal_documents_v`.
- **Conectores de venda** ficam fora da Fase 1. O `NormalizedOperation.items` já existe; com um mapa produto → NCM/CFOP/CSOSN, a regra do conector poderá escolher "NF-e" (Fase 2).

### 8.7 Tipos de erro

| Categoria (já existe em `fiscal-error.ts`) | Origem | O que o cliente vê | O que o Corvo faz |
|---|---|---|---|
| `VALIDATION` | validador, XSD, cStat de rejeição | campo e motivo | nada; espera a correção |
| `INTEGRATION` com retry | timeout, 5xx, rede, 108/109 (serviço paralisado) **[não verificado]** | "processando" | tenta de novo ou consulta pela chave |
| `CONFIGURATION` | sem IE, certificado vencido, UF sem suporte | o que falta na empresa | bloqueia antes de numerar |
| denegada (novo resultado, não é erro) | 110/301/302 | "denegada" | final, guarda o XML |

A API devolve `error.type: 'communication' | 'validation' | 'configuration'`, além do `code` da SEFAZ.

### 8.8 DANFE

Renderizador próprio com `pdfkit`, reusando a estrutura do `danfse-renderer.ts` (fontes Liberation, blocos e grade). O layout segue o Anexo II do MOC: retrato, código de barras Code-128C da chave, quadros de emitente, destinatário, itens com quebra de página, totais e dados adicionais.

O `@nfewizard/danfe` (GPL-3.0) serve de referência de layout. Fixtures de PDF são comparadas por texto extraído, não por pixel.

### 8.9 Assinatura, XSD e segurança

- Assinatura XMLDSig enveloped: RSA-SHA1 com C14N e referência `#NFe{chave}`. A NF-e 4.00 ainda pede SHA-1 **[não verificado se alguma NT recente mudou]**.
- O certificado é decifrado só em memória por operação (`ApplicationCertificateDecryptor`) e nunca vai para log, job ou fila.
- O job carrega o `companyId` e busca o certificado na hora.
- O mTLS usa o PFX direto no `https.Agent` mais a cadeia ICP-Brasil versionada.
- Logs levam chave, cStat, UF e duração; nunca o XML inteiro (traz CPF do destinatário, por causa da LGPD). Um teste "no-leak", como `certificate-upload.no-leak.spec.ts`, cobre o SOAP.
- XSD: os schemas oficiais (pacote PL vigente) ficam versionados em `schemas/`. A validação usa uma implementação sem módulo nativo; candidata: `xmllint-wasm` **[não verificado: avaliar no spike]**.
- Fuso: `dhEmi` sai com o offset da UF do emitente. A SVRS cobre UFs com -04:00 e -05:00. A tabela de offset fica junto da de endpoints.

## 9. Testes

1. **Unidade**: chave e DV (casos conhecidos), `cNF` diferente de `nNF`, cada grupo do builder com fixture, validadores, máquina de estados e tabela de cStat.
2. **Contrato** (seção 6.7): contra o simulado e o real com SOAP falso.
3. **XSD no CI**: toda fixture de saída (NF-e, eventos, inutilização) passa no schema oficial. O CI falha se o XML sair do schema.
4. **Integração Postgres**: numeração concorrente (dois jobs nunca pegam o mesmo número), RLS e idempotência.
5. **Roteiro manual de homologação** (`docs/runbooks/nfe-homologacao.md`, na Fase 1):
   - status do serviço;
   - uma emissão autorizada com CSOSN 102 e outra com 400;
   - uma rejeição proposital;
   - consulta pela chave depois de "perder" a resposta (matar o worker após o envio);
   - cancelamento, duas CC-e e inutilização de uma faixa;
   - fazer tudo isso em SP e em uma UF da SVRS.

## 10. O que o dono precisa providenciar

1. Uma empresa **com Inscrição Estadual** que venda mercadoria, do Simples Nacional, com o A1 (e-CNPJ) dela. A empresa de serviços de Ourinhos/SP talvez não tenha IE (ver pergunta 1).
2. Em SP: credenciamento dessa IE como emissora de NF-e e acesso ao ambiente de homologação. **[não verificado como é hoje; a página da SEFAZ-SP não foi encontrada na pesquisa]**
3. Para a SVRS: uma IE em alguma UF atendida por ela, ou um parceiro que topar testar.
4. Um contador para confirmar NCM, CFOP e CSOSN dos produtos de teste e revisar as mensagens de erro.
5. CSC (token da NFC-e): só na Fase 3.

## 11. Riscos

- **Particularidades de UF/SEFAZ** (SOAP, cadeia TLS, regras extras de SP): mitigado pela tabela de endpoints, pelo roteiro em duas autoridades e pelo sped-nfe como referência.
- **Reforma tributária muda o layout no meio do caminho**: os grupos IBS/CBS já ficam modelados, com flag por data, e acompanhamos as versões da NT 2025.002.
- **Regressão na NFS-e** durante a Fase 0: PRs pequenos, testes atuais intactos e snapshot do OpenAPI.
- **Expectativa de cálculo de imposto**: a documentação e as mensagens deixam claro que o cliente informa os tributos.
- **Biblioteca própria demora mais do que o previsto**: ponto de reavaliação em 3 semanas (seção 5.1).

## 12. Perguntas em aberto (só o dono responde)

1. Qual empresa com IE vai homologar em SP? A sua de Ourinhos tem IE e vende mercadoria? E para a SVRS, existe alguma empresa parceira?
2. Quem entra no beta (flag `nfe_enabled`) e a partir de quando: só você, ou alguns clientes já em homologação?
3. Confirma a regra "cobra só a NF-e autorizada; eventos, inutilização, rejeição e denegação não cobram"?

## 13. Fases seguintes (resumo)

- **Fase 2**: catálogo de produtos, conectores de venda emitindo NF-e (regra por produto), importação por planilha e e-mail com DANFE.
- **Fase 3**: NFC-e (modelo 65, CSC, QR Code, DANFCE), com outro gateway e outro renderer no mesmo registro.
- **Fase 4**: contingência (SVC-AN/SVC-RS como linhas na tabela de endpoints, EPEC como evento) e `tpEmis` diferente de 1.
- **Depois**: regime normal (CRT 3), ST/DIFAL informados, devolução e complementar, mais UFs com SEFAZ própria (linhas novas na tabela) e manifestação do destinatário.
