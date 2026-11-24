# MCP completo: depois do login, o agente faz tudo até emitir e comprar créditos

Data: 2026-11-24. Status: rascunho para aprovação do dono.

## 1. Intenção

O agente (Claude, ChatGPT, bots no Grok, OpenBot, agentes.chat) **sempre pede o login** da pessoa, pelo OAuth que já existe ("Autorizar Corvo"). Depois disso ele faz tudo pelo MCP, sem a pessoa abrir o site:

1. cadastrar a empresa (já existe);
2. enviar o certificado A1 com a senha (**novo**);
3. emitir a nota (já existe);
4. comprar créditos quando acabarem, escolhendo **Pix ou cartão** (**novo**): no Pix volta o QR Code e o código copia-e-cola; no cartão volta o link do checkout da Stripe.

A senha do certificado fica protegida **do lado do agente** (essas plataformas têm cofre). A Corvo não cria cofre: recebe o arquivo e a senha pela ferramenta e garante que nada vaza (sem log, sem devolver na resposta).

## 2. Objetivos, não objetivos e anti-objetivos

**Objetivos**
1. Ferramenta para enviar o certificado.
2. Ferramentas para comprar créditos (Pix ou cartão) e acompanhar o pagamento.
3. Instruções no MCP para o agente seguir o caminho login → empresa → certificado → nota → créditos sem ajuda.

**Não objetivos**
- Criar conta pelo agente (descartado pelo dono: o agente sempre pede login).
- Chave de API no MCP; parte pública sem login.
- Cofre na Corvo ou link de envio pelo navegador.
- Trocar de plano/assinatura pelo MCP (só créditos avulsos agora).

**Anti-objetivos**
- Senha ou arquivo do certificado aparecer em log, Sentry, auditoria, resposta ou mensagem de erro.
- O agente conseguir cobrar sem a pessoa ver: o pagamento sempre é concluído pela pessoa (pagar o Pix ou preencher o cartão na Stripe).

## 3. Como é hoje

- **MCP** (`api/src/modules/mcp/`): só OAuth; escopos `nfse:read` e `nfse:write`; ferramentas registradas em `mcp.service.ts` com `wrapWithScopeCheck`. Já tem `company_create`, `cnpj_lookup`, `company_fiscal_status`, `nfse_issue`, `credits_balance`, `billing_usage`.
- **Certificado**: bloqueado no MCP de propósito (`company_create`/`company_update` recusam; a tela de autorização diz "Certificados A1 e senhas não são disponibilizados ao agente"). `CertificateService` já valida senha, validade e CNPJ e guarda criptografado.
- **Compra**: `POST /billing/checkout` com `kind: 'avulso'`, `units` e `method` (`card`|`pix`) chama `checkoutRouter.start`. O Pix (Woovi) devolve QR Code e copia-e-cola; o cartão devolve a sessão de checkout da Stripe. `GET /billing/payments/:id/status` e `GET /billing/checkout/:sessionId` já informam a situação. A tela do Pix já confirma sozinha.

## 4. Abordagens consideradas

| | Como | Por que não / por que sim |
|---|---|---|
| **A. Ferramentas no MCP com login OAuth** (escolhida) | Novas ferramentas usam os serviços que o site já usa. | Simples; um caminho só; reaproveita validação e pagamento. |
| B. Criação de conta pelo agente + chave | Parte pública do MCP. | Descartada pelo dono. |
| C. Link para a pessoa abrir no site | Agente manda link do painel. | Não é "agente faz tudo". |

## 5. Desenho

### 5.1 Permissões (tela "Autorizar Corvo")

Dois escopos novos, cada um como caixa separada na tela de autorização, **desmarcados por padrão**:
- `nfse:certificates` — "Enviar o certificado digital da empresa".
- `billing:purchase` — "Gerar cobranças de créditos (Pix ou cartão). O pagamento é sempre feito por você."

Conexões antigas continuam funcionando; para usar as ferramentas novas, a pessoa autoriza de novo (o erro da ferramenta diz isso em linguagem simples). A frase atual "Certificados A1 e senhas não são disponibilizados ao agente" sai, e no lugar entra: "Se você permitir, o agente pode enviar o certificado. A Corvo guarda criptografado e nunca devolve a senha."

### 5.2 `certificate_upload(tax_id, pfx_base64, password)`

- Acha a empresa pelo CNPJ (padrão de `nfse_get_package_url`), decodifica o base64 e chama `CertificateService`: mesma validação e armazenamento do site, um certificado ativo por empresa e ambiente, substitui o anterior (a resposta avisa).
- Limite: 50 KB do arquivo decodificado; o corpo do `/mcp` aceita até ~100 KB.
- Devolve só dados públicos: CNPJ, titular, validade, se substituiu outro.
- Erros simples: "senha errada ou arquivo inválido", "certificado vencido", "o CNPJ do certificado é X, o da empresa é Y".
- **Nunca vazar**: argumentos desta ferramenta fora de qualquer log (requisição do MCP, Sentry, auditoria); erro de validação de parâmetro não ecoa valores. Teste automatizado prova que `password` e `pfx_base64` não aparecem em log nem em resposta, inclusive nos erros.
- Registra evento "certificado enviado pelo agente" (sem argumentos).
- Mensagens de `company_create`/`company_update` passam a apontar para `certificate_upload`.

### 5.3 Comprar créditos

- **`credits_purchase(units, method)`** — `method` é `pix` ou `card`. Chama `checkoutRouter.start` com `kind: 'avulso'` (mesmos preços, mínimos e regras do site; chave de idempotência gerada pela ferramenta). Devolve:
  - **Pix**: `payment_id`, valor, validade, código **copia-e-cola**, **imagem do QR Code** (como conteúdo de imagem do MCP, para o agente mostrar) e o link da página de pagamento da Woovi.
  - **Cartão**: `checkout_url` da Stripe, valor e `session_id`.
  - Texto para o agente: "Mostre o QR Code/link para a pessoa pagar. Depois consulte com `payment_status`."
- **`payment_status(payment_id | session_id)`** — reaproveita `paymentStatus` (Pix) e o status do checkout (cartão). Devolve `pendente`, `pago` (com o novo saldo de créditos) ou `expirado/cancelado`.
- Antes de cobrar, a ferramenta informa o preço (a descrição orienta o agente a confirmar valor e quantidade com a pessoa).
- Exige o escopo `billing:purchase` e a permissão `billing.manage` do usuário (membro sem essa permissão recebe erro claro).
- `nfse_issue`, quando falta crédito, passa a sugerir `credits_purchase` na mensagem de erro.
- Modo self-hosted (sem cobrança): as ferramentas de compra não aparecem.

### 5.4 Roteiro do agente

```
(login OAuth)
cnpj_lookup(cnpj)                         → dados da Receita
company_create(...)                       → empresa
certificate_upload(cnpj, pfx, senha)      → certificado OK
company_fiscal_status(cnpj)               → pronto para emitir
nfse_issue(...)                           → nota
credits_balance()                         → saldo
credits_purchase(units, "pix"|"card")     → QR Code / link Stripe
payment_status(id)                        → pago → segue emitindo
```

As descrições das ferramentas e o texto de instruções do `initialize` seguem esse roteiro.

## 6. Ordem de entrega

1. Certificado pelo MCP (escopo, ferramenta, textos, teste de não vazamento).
2. Compra de créditos pelo MCP (escopo, `credits_purchase`, `payment_status`, dica no erro de crédito).
3. Instruções do MCP + documentação (página do MCP no site e `llms.txt`).

As etapas 1 e 2 são independentes e podem andar em paralelo. Cada uma é um PR com CI verde.

## 7. Restrições

- Padrão de ferramentas de `mcp/tools/` e `wrapWithScopeCheck`; tudo no escopo da conta (RLS).
- Numeração fiscal não muda. Textos para o cliente em português simples; cobrança é "cartão ou Pix".

## 8. Fica para quem constrói

- Texto exato das descrições e erros, seguindo o roteiro.
- Formato da imagem do QR Code (PNG em base64 como conteúdo `image` do MCP, ou URL da imagem que a Woovi já fornece).

## 9. Em aberto (decisão do dono)

- Tabela de atividade da conta (quem fez o quê: membro ou agente) e tela "Atividade" no painel: entra neste projeto ou depois?
