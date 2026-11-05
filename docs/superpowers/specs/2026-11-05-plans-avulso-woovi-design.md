# Novos planos, nota avulsa e pagamento Pix (Woovi) — Design

Data: 2026-11-05

## Intenção

Simplificar a cobrança da Corvo. Hoje o sistema é só mensal, só cartão e só Stripe, com cobrança de excedente. O objetivo é: planos mais simples (com opção anual), sem excedente, uma primeira nota grátis, compra de notas avulsas, e Pix como forma de pagamento ao lado do cartão.

Princípio: ficar simples. Pagou o plano, emite até a cota. Precisou de mais, compra notas ou escolhe um plano maior.

## Objetivos

- Planos Solo, Equipe, Empresa e Escala, mensal e anual (anual = 30% de desconto, cobrado como valor mensal equivalente).
- Sem cobrança de excedente. Ao acabar a cota, a emissão bloqueia.
- Primeira nota grátis, uma única vez por conta, sem exigir plano.
- Nota avulsa a R$ 0,99, mínimo de 3 notas, paga por Pix (Woovi) ou cartão (Stripe). Não exige plano.
- Plano recorrente por Pix Automático (Woovi) ou cartão (Stripe).
- Calculadora "preciso de N notas" que mostra a opção mais barata.

## Não objetivos

- Não haverá cobrança pós-paga de nenhum tipo (sem medidor, sem invoice item de excedente).
- Não há plano gratuito mensal. O free de 15 notas por mês deixa de existir.
- Homologação (teste) é sempre grátis, sem plano e sem limite.
- Quando a emissão bloqueia por falta de cota/saldo, oferecer comprar notas avulsas ali mesmo.
- Não há migração de assinantes: hoje não existem assinaturas ativas.
- Não usar QR Code estático da Woovi para cobrar a Corvo (ver Pagamento).

## Anti-objetivos (falha mesmo que "funcione")

- Pix pago e plano ou saldo não liberado, ou liberado duas vezes (webhook repetido).
- Uma pessoa criar várias contas para ganhar várias notas grátis.
- Números de plano divergentes entre API, Stripe e web.

## Catálogo (decidido pelo usuário, exceto onde marcado)

| Plano | Mensal | Anual (por mês) | Total do anual | Notas/mês |
|---|---|---|---|---|
| Solo | R$ 59,90 | R$ 41,90 | R$ 502,80 | 100 |
| Equipe | R$ 119,90 | R$ 83,90 | R$ 1.006,80 | 250 |
| Empresa | R$ 239,90 | R$ 167,90 | R$ 2.014,80 | 600 |
| Escala | R$ 399,90 | R$ 279,90 | R$ 3.358,80 | 1.200 |

Referência: cada plano custa ~20% menos que o concorrente pesquisado (75/200/500/1.000 notas por R$ 75/149/299/499), com mais notas; o anual tem 30% de desconto sobre o mensal. Avulso R$ 0,99.

Usuário confirmou esta tabela. Slugs internos novos sugeridos: `solo`, `equipe`, `empresa`, `escala` (escolha do builder).

Observação: o anual é cobrado de uma vez, 12 x o valor mensal equivalente (ver "Decisões do usuário").

## Regras de negócio

- **Cota do plano:** notas incluídas por período. Ao esgotar, bloqueia (sem teto de 5x, sem excedente). O limite efetivo é cota do plano + saldo de notas avulsas.
- **Ordem de consumo:** cota do plano primeiro, depois saldo avulso. (Escolha do assistente.)
- **Primeira nota grátis:** 1 nota por conta, uma vez na vida, não renova. Reativar o `FreeAbuseChecker` (e-mail, CNPJ/CPF, Turnstile) hoje não está ligado ao cadastro.
- **Avulso:** R$ 0,99 por nota, mínimo 3 notas. Notas compradas não expiram (escolha do assistente). Saldo vive no ledger de créditos (`credit_transactions`, fonte `avulso` já existe).
- **Notas em ambiente de teste** não consomem nada (comportamento atual mantido).
- **Calculadora:** dado N notas por mês, compara (a) cada plano que cubra N e (b) plano menor + avulsas para o restante, e mostra a opção mais barata. Adaptar `recommendPlanForVolume`.

## Pagamento

- **Cartão:** Stripe, como hoje (checkout hospedado). Plano mensal/anual recorrente; avulso como pagamento único.
- **Pix plano recorrente:** Woovi Pix Automático (referência: developers.woovi.com/docs/woovi-prompts/pix-automatico).
- **Pix avulso:** cobrança Pix única da Woovi (`/charge`, com `correlationID` gerado pela Corvo). Decisão: não usar QR estático (`/qrcode-static`), pois ele é reutilizável, não expira e não tem TXID, o que dificulta saber qual compra foi paga. O prompt de QR estático foi avaliado e descartado para este fim.
- **Backend-only:** App ID da Woovi nunca vai ao frontend.
- **Webhook Woovi** de cobrança da Corvo: verificar assinatura, deduplicar por evento/`correlationID`, e então liberar plano ou creditar saldo. Idempotente.
- **Abstração:** `BillingProvider` hoje é específico do Stripe (meter, portal, invoice item). Precisa ser generalizado ou ganhar um provider paralelo para Woovi. `PAYMENT_ALLOWED_PROVIDERS` e `PAYMENT_DEFAULT_PROVIDER` hoje só aceitam `stripe`.
- O conector Woovi existente em `api/src/modules/integrations/connectors/woovi/` é para clientes da Corvo (Pix deles vira NFS-e). Não é reaproveitável como cobrança da Corvo, só como referência de verificação de assinatura.

## Tela (web)

- Checkout simples: escolher plano (mensal/anual) ou avulso, escolher Pix ou cartão.
- No anual, o dashboard mostra o valor por mês (ex.: R$ 41,90/mês) com o valor mensal cheio riscado ao lado (ex.: ~~R$ 59,90~~). Como a cobrança é de uma vez, o total do ano (ex.: R$ 502,80, cobrado uma vez) aparece em texto menor, para não haver surpresa no checkout. A mesma apresentação vale na página pública de preços.
- Remover `annualTotalCents` e `cycle` herdados; adicionar seletor mensal/anual.
- Calculadora "preciso de N notas".
- Textos em português e inglês (`web/messages/pt.json`, `en.json`).

## Pontos de código a mudar (mapeados)

- Catálogo em três cópias: `api/.../plan-seeder.service.ts`, `api/.../pricing.service.ts` (`PRICING`), `web/lib/plans-catalog.ts` (e `web/tests/helpers/pricing-catalog.ts`). Mais uma migration de dados (o seed não atualiza linhas existentes).
- Stripe: rodar de novo `api/scripts/provision-stripe.ts`; remover preço metered de excedente; adicionar preços anuais; novo fluxo de pagamento único para avulso.
- Excedente: remover `overage-report.service.ts`, job no scheduler e `OVERAGE_MULTIPLIER` em `billing-policy.ts`.
- Aplicação de cota: `BillingUsageService.reserve` e `BillingPeriod.reserve` passam a considerar cota + saldo avulso, sem teto de 5x.
- Reativar `CreditsService.purchaseCredits`/`previewPurchase` (hoje código morto, controller retorna Gone).
- Cadastro: `PasswordlessWorkspaceService.ensureWorkspace` (cria hoje o tenant no plano free).

## Deixado ao builder

- Nomes de slug, estrutura de tabelas e migrations.
- Como modelar o Pix Automático (autorização do pagador, ciclo de cobrança, o que fazer quando uma parcela mensal falha) seguindo a documentação da Woovi.
- Estratégia de rollout e testes.

## Escolhas do assistente (a conferir)

- Saldo avulso não expira.
- Cota do plano consome antes do saldo avulso.
- Primeira nota grátis é "uma vez na vida" por conta.
- Mínimo avulso = 3 notas (usuário disse "10 créditos" e depois "a partir de 3"; assumi 3).
- Cota do plano reseta todo mês, inclusive no anual (100/mês, não 1.200 no ano). Notas do plano não usadas expiram no fim do período.
- Falha de parcela/pagamento: carência de 7 dias (igual à atual do Stripe), depois bloqueia emissão pelo plano. Saldo avulso continua utilizável.
- Troca de plano só vale na próxima renovação (sem proration). Não migra entre Stripe e Woovi no meio do período. Avulso pode ser pago por qualquer provider, independente do plano.
- Antiabuso da nota grátis: cadastro bloqueado pelo checker é criado sem a nota grátis (não é rejeitado). E-mail normalizado (plus-addressing) e CNPJ/CPF contam como "mesma pessoa". A nota é concedida no primeiro login.
- Cobrança Pix avulsa expira em 24h; expirada sem pagamento não credita nada e o registro é marcado como expirado. Reembolso é manual, fora de escopo.
- NFS-e/recibo das cobranças da própria Corvo: fora de escopo deste design.

## Decisões do usuário (rodada de revisão)

- **Anual:** pago de uma vez, pelo valor cheio (12 x o mensal equivalente, ex.: Solo = R$ 502,80), tanto no Pix quanto no cartão. Pix anual é uma cobrança única; Pix Automático fica só para o plano mensal. A cota continua resetando todo mês durante os 12 meses.
- **Usuários já existentes no free de 15/mês:** passam a ser tratados como novos: ficam sem plano e ganham a "primeira nota grátis".
- **Pix Automático:** já está ativo na conta Woovi da Corvo. O usuário vai colocar as chaves no env. Sem necessidade de fasear.

## Perguntas em aberto

Nenhuma.
