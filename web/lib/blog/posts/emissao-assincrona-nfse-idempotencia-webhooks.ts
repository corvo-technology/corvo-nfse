import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "emissao-assincrona-nfse-idempotencia-webhooks",
  title: "Emissão assíncrona de NFS-e: idempotência, webhooks e status sem nota duplicada",
  seoTitle: "Emissão assíncrona de NFS-e: idempotência e webhooks",
  description:
    "Como integrar a emissão assíncrona de NFS-e sem duplicar nota: Idempotency-Key, status fiscais, webhooks assinados, retry com Retry-After e emissão em lote.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "integracao",
  keywords: [
    "idempotência NFS-e",
    "webhook NFS-e",
    "emissão assíncrona de nota fiscal",
    "Idempotency-Key",
    "status da NFS-e",
    "emitir NFS-e em lote",
  ],
  answer:
    "Para não duplicar nota, envie sempre um `Idempotency-Key` estável por operação de negócio e repita a mesma requisição, com o mesmo conteúdo, após qualquer timeout. Trate o `202` como “recebido”, acompanhe o status por webhook e só considere a nota pronta em `authorized` (e os documentos prontos em `nfse.invoice.documents_ready`).",
  blocks: [
    {
      kind: "p",
      text: "O erro mais caro numa integração de nota fiscal não é a nota que falha: é a nota que sai **duas vezes**. Acontece quando o seu sistema perde a resposta por causa de um timeout, não sabe se a emissão aconteceu e tenta de novo. Sem uma chave de repetição, a segunda tentativa vira uma segunda nota.",
    },
    {
      kind: "p",
      text: "Este guia reúne os quatro mecanismos que evitam isso na API da Corvo: idempotência, leitura correta de status, webhooks e repetição com espera. Se você ainda não emitiu a primeira nota, comece por [API de NFS-e: como emitir por API](/pt/blog/api-de-nfse-emitir-nota-fiscal-de-servico).",
    },
    { kind: "h2", text: "Por que a emissão é assíncrona" },
    {
      kind: "p",
      text: "`POST /v1/invoices` não espera a Sefin. Ele valida o pedido, reserva o que for preciso e responde `202` com a nota em `queued`. A transmissão acontece depois. O resultado chega por `GET /v1/invoices/:id` ou por webhook. Detalhes na página [Emissão assíncrona](/pt/docs/async-issuance) da documentação.",
    },
    { kind: "h2", text: "Idempotency-Key: a regra que evita a nota duplicada" },
    {
      kind: "p",
      text: "Enviando o header `Idempotency-Key`, a Corvo reconhece uma repetição. Com a **mesma chave, na mesma conta e ambiente, e com conteúdo equivalente**, a resposta é a mesma nota, não uma nova. Com a mesma chave e conteúdo diferente, a resposta é `409` com `ERROR_IDEMPOTENCY_CONFLICT`. Sem chave, não há deduplicação alguma.",
    },
    {
      kind: "table",
      head: ["Situação", "Resultado"],
      rows: [
        ["Mesma chave, mesmo conteúdo", "Devolve a mesma nota."],
        ["Mesma chave, conteúdo diferente", "`409` com `ERROR_IDEMPOTENCY_CONFLICT`."],
        ["Sem `Idempotency-Key`", "Cada chamada pode emitir uma nota nova."],
      ],
    },
    { kind: "h3", text: "Como escolher a chave" },
    {
      kind: "p",
      text: "Use algo que identifique a **operação de negócio**, não a tentativa: `pedido_123_emissao`, `assinatura_88_2026-11`. Um UUID novo a cada tentativa derrota o propósito, porque cada repetição parece uma operação diferente. Guarde a chave junto do pedido para reutilizá-la depois de uma falha.",
    },
    { kind: "h3", text: "A armadilha do hash" },
    {
      kind: "callout",
      tone: "warn",
      text: "O hash do conteúdo é calculado **antes** da normalização fiscal. Por isso, ao repetir uma requisição, não altere a representação dos campos: o mesmo CNPJ com e sem pontuação pode gerar hashes diferentes e disparar o `409`. Guarde o corpo exato enviado e reenvie igual.",
    },
    { kind: "h2", text: "Lendo os status da nota" },
    {
      kind: "p",
      text: "Uma nota passa por estes status fiscais: `queued`, `processing`, `authorized`, `rejected`, `retry_pending`, `reconciliation_required`, `manual_review`, `failed`, `cancelling` e `cancelled`. Na prática, o seu código precisa distinguir três grupos:",
    },
    {
      kind: "table",
      head: ["Grupo", "Status", "O que fazer"],
      rows: [
        ["Em andamento", "`queued`, `processing`, `retry_pending`", "Aguardar. Não reenviar."],
        ["Concluída", "`authorized`, `cancelled`", "Registrar no seu sistema."],
        [
          "Exige atenção",
          "`rejected`, `reconciliation_required`, `manual_review`, `failed`",
          "Corrigir a causa ou acionar o suporte. Não reemitir às cegas.",
        ],
      ],
    },
    {
      kind: "callout",
      tone: "accent",
      text: "**Autorizada não significa documentos prontos.** Não presuma que XML e PDF estão disponíveis assim que a nota fica `authorized`. O evento `nfse.invoice.documents_ready` avisa quando eles podem ser baixados.",
    },
    { kind: "h2", text: "Webhooks: receber em vez de ficar perguntando" },
    {
      kind: "p",
      text: "Consultar `GET /v1/invoices/:id` em loop funciona, mas gasta limite de requisições e atrasa a reação. Cadastre um endpoint de webhook e reaja aos eventos. Os principais:",
    },
    {
      kind: "ul",
      items: [
        "`nfse.invoice.authorized` e `nfse.invoice.rejected`: o resultado da emissão.",
        "`nfse.invoice.documents_ready`: XML e PDF disponíveis.",
        "`nfse.invoice.cancelled` e `nfse.invoice.cancellation_rejected`: o resultado de um cancelamento.",
        "`nfse.invoice.manual_review`, `nfse.invoice.reconciliation_required` e `nfse.invoice.failed`: casos que pedem atenção.",
      ],
    },
    {
      kind: "p",
      text: "Cada entrega vem assinada no header `X-Corvo-Signature`. Valide a assinatura antes de confiar no corpo; os [SDKs oficiais](/pt/docs/sdks) trazem uma função que faz essa verificação em tempo constante. Responda `2xx` rápido e processe o trabalho pesado fora da requisição. Entregas que falham ficam registradas e podem ser reenviadas com `POST /v1/webhooks/deliveries/:id/retry`. O guia [Recebendo webhooks](/pt/docs/receiving-webhooks) mostra o contrato completo.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "Um webhook pode chegar mais de uma vez. Faça o seu tratamento ser idempotente também: se você já registrou a nota como `authorized`, receber o evento de novo não deve gerar um segundo e-mail ao cliente.",
    },
    { kind: "h2", text: "Repetição com espera: 429 e 503" },
    {
      kind: "p",
      text: "Em `429` (limite de requisições) e `503` (servidor ocupado), a regra é esperar e repetir. Respeite o header `Retry-After`, que informa os segundos até a próxima tentativa, e use espera exponencial em picos. Na emissão, **preserve a chave de idempotência e o corpo**: repetir com ambos iguais é seguro por definição.",
    },
    {
      kind: "code",
      label: "Repetição segura com a mesma chave (Node.js)",
      language: "javascript",
      code: `async function emitir(pedido, tentativa = 1) {
  const res = await fetch("https://api.corvo.tech/v1/invoices", {
    method: "POST",
    headers: {
      "X-API-Key": process.env.CORVO_API_KEY,
      "Content-Type": "application/json",
      // estável por operação de negócio, igual em toda repetição
      "Idempotency-Key": \`pedido_\${pedido.id}_emissao\`,
    },
    body: pedido.corpoEnviado, // mesmo texto, sem reformatar campos
  });

  if ((res.status === 429 || res.status === 503) && tentativa < 5) {
    const espera = Number(res.headers.get("Retry-After") ?? 2 ** tentativa);
    await new Promise((resolve) => setTimeout(resolve, espera * 1000));
    return emitir(pedido, tentativa + 1);
  }
  return res.json(); // 202 com a nota em "queued"
}`,
    },
    { kind: "h2", text: "Emissão em lote" },
    {
      kind: "p",
      text: "Para emitir muitas notas de uma vez, `POST /v1/invoices/batches` aceita de 1 a 50 itens por chamada. Cada item pode ter o próprio `idempotencyKey` (por exemplo, `arquivo-linha-7`). Os itens são conferidos um a um: os válidos são salvos juntos e os inválidos voltam como `rejected`, sem serem salvos. Depois de um timeout, repetir o lote inteiro devolve as notas já salvas com `replayed: true` e tenta só as que faltam. A rota aceita até 10 lotes por minuto por tenant.",
    },
    { kind: "h2", text: "Resumo para colar no seu checklist" },
    {
      kind: "ul",
      items: [
        "Uma chave de idempotência por operação de negócio, guardada junto do pedido.",
        "Reenvio sempre com o corpo exato original.",
        "`202` é “recebido”; o resultado vem por webhook.",
        "Assinatura `X-Corvo-Signature` validada antes de qualquer ação.",
        "Tratamento de webhook idempotente.",
        "`Retry-After` respeitado em `429` e `503`.",
      ],
    },
  ],
  faq: [
    {
      q: "O que acontece se eu repetir uma emissão com a mesma Idempotency-Key?",
      a: "Se o conteúdo for equivalente, a Corvo devolve a mesma nota e não emite outra. Se o conteúdo for diferente, a resposta é `409` com `ERROR_IDEMPOTENCY_CONFLICT`.",
    },
    {
      q: "Preciso enviar Idempotency-Key em toda emissão?",
      a: "Sim, é a prática recomendada. Sem a chave não há deduplicação, e uma repetição depois de um timeout pode emitir uma segunda nota.",
    },
    {
      q: "Quando a nota está realmente pronta?",
      a: "Quando o status é `authorized`. Os documentos (XML e PDF) podem demorar um pouco mais: o evento `nfse.invoice.documents_ready` avisa quando estão disponíveis.",
    },
    {
      q: "Como sei que um webhook veio mesmo da Corvo?",
      a: "Pelo header `X-Corvo-Signature`. Valide a assinatura antes de usar o corpo. Os SDKs oficiais têm uma função de verificação em tempo constante.",
    },
    {
      q: "Posso consultar o status em vez de usar webhook?",
      a: "Pode, com `GET /v1/invoices/:id`. Funciona, mas consome limite de requisições e reage mais devagar. Para volume, prefira webhooks e deixe a consulta como reforço.",
    },
  ],
  readNext: ["api-de-nfse-emitir-nota-fiscal-de-servico", "ibs-cbs-nfse-reforma-tributaria-api"],
};
