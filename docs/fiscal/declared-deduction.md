# Dedução da base do ISS declarada pelo emitente (`deduction`)

O emitente pode declarar em `deduction` um valor que a legislação do município
permite abater da base de cálculo do ISS. O valor é enviado na DPS em
`vDedRed/vDR` e reduz a base do ISS. A nota continua sendo emitida pelo valor
total (`amount`).

> **Responsabilidade.** O emitente declara o valor e responde por ele. O Corvo
> emite o que foi informado: não confere se a dedução é permitida para o
> serviço ou município e não substitui o contador.

## Como usar

### API

```http
POST /v1/invoices
{
  "companyTaxId": "11222333000181",
  "service": { "description": "Serviço de manutenção" },
  "amount": 100,
  "deduction": 40,
  "competenceDate": "2026-10-20"
}
```

`POST /v1/invoices/calculate` aceita o mesmo campo e mostra o ISS já com a
dedução. No MCP, `nfse_issue` e `nfse_calculate` aceitam `deduction`.

### Dashboard

Em **Nova nota**, a seção "Serviço" tem o campo opcional **Dedução da base do
ISS**. Ele aparece no resumo, é validado antes do envio e é copiado ao duplicar
uma nota. A tela da nota mostra a dedução quando existe.

## Regras de validação

| Regra | Resultado |
| --- | --- |
| `deduction` ausente ou `0` | Sem dedução; nada muda na nota. |
| `deduction < 0` | `422`, `out_of_range`. |
| Mais de 2 casas decimais | `422`, `invalid_decimal_places`. |
| `deduction >= amount − discount` | `422`, `out_of_range`: a base do ISS precisa sobrar. |

## O que a dedução altera

| Item | Tratamento |
| --- | --- |
| DPS | Grupo `valores/vDedRed/vDR`, após `vServPrest`, validado contra o schema RTC v1.01. |
| Base do ISS | `amount − discount − deduction`. |
| Retenções federais | Base inalterada (`amount − discount`). |
| IBS/CBS | Calculado sobre o valor **sem** a dedução. Ver limitações. |
| Líquido a receber | Não muda. |
| Snapshot fiscal | `taxableAmounts.deduction` no JSON do resultado (sem coluna nova). |
| Aviso | `DECLARED_DEDUCTION_APPLIED` em `warnings` do cálculo. |

MEI e Simples Nacional não carregam ISS calculado (o ISS está no DAS): para eles
a dedução só vai na DPS.

## Falha fechada

Sem snapshot fiscal (motor fiscal não rodou), a nota **não** é emitida com
dedução: a emissão é rejeitada com `FISCAL_VALIDATION_FAILED`. O payload legado
não carrega a dedução, e emitir assim tributaria o valor cheio sem aviso.

## Persistência

A dedução fica em `invoices.service_snapshot` (jsonb), junto do desconto, e é
reidratada por `InvoiceMapper`. **Não há migration.**

> **Correção junto desta mudança.** `InvoiceMapper.toPersistence` lia o
> `discount` de dentro de `serviceSnapshot`, mas ele vive no nível da nota, e
> por isso o desconto incondicional era perdido ao gravar: o preview de cálculo
> o considerava, mas a DPS emitida saía sem `vDescIncond`. O mapeador agora
> grava `discount` e `deduction`. Notas já gravadas não têm esses valores.

## Limitações

Ver `docs/fiscal/limitations.md` (linha "Dedução declarada pelo emitente",
seção 2 e decisão D4). Em resumo: não homologado na Produção Restrita;
aceitação por município e pelo sistema nacional não confirmada; IBS/CBS não é
reduzido pela dedução.
