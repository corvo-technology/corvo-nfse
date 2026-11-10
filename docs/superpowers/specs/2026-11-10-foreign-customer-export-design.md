# Nota para cliente no exterior (tomador estrangeiro e exportação de serviço)

Data: 2026-11-10. Status: aguardando aprovação. Duas fases, cada uma em PR próprio: **1** tomador no exterior; **2** exportação de serviço.

## Intenção

Quem presta serviço para cliente de fora do Brasil (freelancer, agência, software house) hoje não consegue emitir pela Corvo: a nota só aceita CPF ou CNPJ. A pessoa deve poder informar um cliente estrangeiro e, quando for o caso, declarar a exportação do serviço.

## O que verificamos

Fontes: XSD v1.01 e o conjunto de regras oficiais que vêm com a `open-nfse` (`specs/ruleset/emissao.regras.json`), além do guia do Emissor Nacional v1.3.

- O tomador é identificado por **um** destes: `CNPJ`, `CPF`, `NIF` (identificação fiscal no país dele) ou `cNaoNIF` (motivo de não ter NIF).
- Com `NIF`, o nome é obrigatório (**E0233**).
- Com `NIF` e emitente identificado por CNPJ, o endereço no exterior é obrigatório (**E0242**).
- Com endereço no exterior, é obrigatório `NIF` ou `cNaoNIF` (**E0223**). `cNaoNIF = 0` é rejeitado (**E0226**).
- O país do endereço tem de existir na tabela ISO2 e ser diferente de `BR` (**E0246**).
- Exportação é `tribISSQN = 3`. Em alguns cenários o emitente não pode declarar exportação (**E0529**) e em outros não pode declarar operação tributável (**E0530**). Os cenários estão na planilha oficial `EXPORTACAO_EMISSÃO_NFS-e` do Anexo I.
- Em exportação com prestação no Brasil, é obrigatório informar o país onde ocorreu o resultado do serviço, `cPaisResult` (**E0590**).
- O grupo de comércio exterior (`comExt`) tem campos em que o valor `0` é rejeitado (`mdPrestacao` E0333, `mecAFComexP` E0341, `mecAFComexT` E0343, `movTempBens` E0345) e dependências entre `movTempBens`, `nDI` e `nRE` (E0352, E0354, E0356).
- A `open-nfse` já tem os tipos (`NIF`, `cNaoNIF`, `endExt`, `ComExterior`, `cPaisResult`). O caminho simples dela (`emitir`) não cobre tomador no exterior; a DPS precisa ser montada à mão. A Corvo já monta a DPS no `DpsBuilder` e envia por `emitirDpsPronta`.

## Não verificado

- **A matriz de cenários** (`EXPORTACAO_EMISSÃO_NFS-e`): não está no repositório. As regras citam os números dos cenários, mas não a tabela. Precisa ser trazida do Anexo I antes da fase 2.
- **Se o MEI pode declarar exportação** e como a receita de exportação entra no DAS do Simples Nacional. Não achamos regra do sistema nacional que proíba, mas o enquadramento é do contador.
- **Efeito no IBS/CBS** de uma operação de exportação.
- Aceitação pela Sefin em homologação: nenhuma dessas notas foi emitida.

---

## Fase 1. Tomador no exterior

### Metas

- `customer` aceita um cliente estrangeiro em vez de CPF/CNPJ.
- A DPS sai com `toma/NIF` (ou `cNaoNIF`), `xNome` e `end/endExt`.
- Vale para nota avulsa, lote, agenda e MCP. Planilha fica para depois.

### Contrato proposto

```json
"customer": {
  "name": "Acme Inc.",
  "foreign": {
    "taxId": "12-3456789",
    "noTaxIdReason": null,
    "country": "US",
    "postalCode": "94105",
    "city": "San Francisco",
    "region": "CA",
    "street": "1 Market St",
    "number": "100"
  }
}
```

- `customer.taxId` (CPF/CNPJ) e `customer.foreign` são **mutuamente exclusivos**.
- `foreign.taxId` (NIF) ou `foreign.noTaxIdReason` (`exempt` ou `not_required`, que viram `cNaoNIF` 1 ou 2): exatamente um. **Confirmar os códigos de `cNaoNIF` no enum `CodigoNaoNif` antes de fixar os nomes.**
- `name` e o endereço no exterior são obrigatórios.
- `country` em ISO2, diferente de `BR`, validado contra uma tabela local.

### Fluxo

1. DTO e normalização validam o formato e a exclusividade. Erros seguem o catálogo atual (`required`, `invalid_option`, `not_allowed`).
2. O snapshot do cliente guarda o bloco `foreign` (o `customer_snapshot` é `jsonb`; **sem migration**).
3. O `DpsBuilder` monta `toma` com `NIF` ou `cNaoNIF` e `end.endExt`. Sem snapshot fiscal, a nota é rejeitada com erro claro, como já acontece com a dedução.
4. O DANFSe local já lê o tomador da DPS; conferir se imprime endereço no exterior.
5. Clientes salvos: **não** guardar cliente estrangeiro nesta fase (a tabela é indexada por CPF/CNPJ).

### Anti-metas

- Nunca aceitar `BR` como país de um cliente estrangeiro.
- Nunca enviar `NIF` e `cNaoNIF` juntos.
- Fase 1 **não** declara exportação: a tributação segue a mesma de hoje. Um cliente estrangeiro não é, por si só, exportação.

### Testes

Normalização (exclusividade, país, motivo); DPS com `NIF` e com `cNaoNIF` válida no XSD v1.01; DPS de cliente brasileiro byte a byte igual à de hoje; rejeição sem snapshot fiscal.

---

## Fase 2. Exportação de serviço

### Metas

- A nota declara exportação (`tribISSQN = 3`) com o país do resultado (`cPaisResult`) e o grupo `comExt`.
- A Corvo recusa, antes de enviar, as combinações que a Receita recusaria (E0529, E0530, E0590).

### Contrato proposto

```json
"export": {
  "resultCountry": "US",
  "currency": "USD",
  "amountInCurrency": 1000.00,
  "deliveryMode": "cross_border"
}
```

Os demais campos de `comExt` (`vincPrest`, `mecAFComexP`, `mecAFComexT`, `movTempBens`, `nDI`, `nRE`, `mdic`) entram com valores padrão **a definir com um contador** e ficam editáveis em um modo avançado.

### Pré-requisitos (bloqueiam a fase 2)

1. Trazer a matriz `EXPORTACAO_EMISSÃO_NFS-e` para o repositório, como dado versionado, com teste de conformidade (como já existe `anexo1-conformance.spec.ts`).
2. Validar com um contador os valores padrão de `comExt` para o caso comum (serviço prestado do Brasil para cliente no exterior, pago em moeda estrangeira) e o tratamento no Simples Nacional.
3. Emitir pelo menos uma nota de exportação em homologação e conferir o retorno.

### Anti-metas

- A Corvo **não decide** se a operação é exportação. O emitente declara e responde; a Corvo só impede combinações que a Receita recusa.
- Nenhum valor padrão de `comExt` entra em produção sem validação contábil.

---

## Decisões para o dono do produto

1. Fazer a fase 1 sozinha já resolve "emitir para cliente de fora"? Para muitos casos a nota com tomador estrangeiro, tributada normalmente, pode não ser o que o contador quer.
2. Quem valida os valores padrão de `comExt`?
3. Painel: campo "cliente no exterior" no formulário de nova nota na fase 1 ou só API primeiro?
