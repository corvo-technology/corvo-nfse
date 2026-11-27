import type { BlockReason } from './integration-operation';

export interface BlockReasonText {
  /** What happened, in one short sentence. */
  title: string;
  /** What the client can do about it. */
  action: string;
}

/** Plain-language reasons shown to the client in e-mails. The web app has the same texts in pt and en. */
export const BLOCK_REASON_TEXT: Record<BlockReason, BlockReasonText> = {
  connection_inactive: {
    title: 'A integração está pausada ou desligada.',
    action: 'Ligue a integração de novo e tente emitir esta venda.',
  },
  before_active_from: {
    title: 'A venda é anterior à data em que a integração começou a valer.',
    action: 'Se quiser a nota mesmo assim, emita pela tela de notas fiscais.',
  },
  refunded: {
    title: 'A venda foi reembolsada.',
    action: 'Nenhuma nota é emitida para venda reembolsada.',
  },
  disputed: {
    title: 'A venda está em disputa na plataforma.',
    action: 'Espere a disputa terminar; a nota só sai se a venda ficar paga.',
  },
  not_paid: {
    title: 'A venda ainda não foi paga.',
    action: 'A nota sai sozinha assim que o pagamento for confirmado.',
  },
  unsupported_currency: {
    title: 'A venda não foi feita em reais.',
    action: 'O Corvo só emite nota para vendas em reais (BRL).',
  },
  invalid_amount: {
    title: 'O valor da venda é inválido.',
    action:
      'Confira o valor na plataforma; a nota precisa de um valor maior que zero.',
  },
  seller_not_issuer: {
    title: 'A plataforma informa que outra empresa emite a nota desta venda.',
    action: 'Se você mesmo deve emitir, emita pela tela de notas fiscais.',
  },
  no_rule: {
    title: 'Não há uma regra de emissão para esta venda.',
    action: 'Abra a integração e defina o serviço padrão das notas.',
  },
  ambiguous_rule: {
    title: 'Mais de uma regra serve para esta venda.',
    action: 'Abra a integração e deixe uma só regra para cada produto.',
  },
  customer_tax_id_missing: {
    title: 'Falta o CPF ou CNPJ do cliente.',
    action: 'Informe o documento do cliente e emita a nota.',
  },
  refund_after_invoice: {
    title: 'A venda foi reembolsada depois de a nota ser emitida.',
    action: 'Cancele a nota, se for o caso.',
  },
  cancel_requested: {
    title: 'O cancelamento da nota foi pedido por causa do reembolso.',
    action: 'Nada a fazer: acompanhe o cancelamento na nota.',
  },
  cancel_failed: {
    title: 'Não conseguimos cancelar a nota depois do reembolso.',
    action: 'Tente de novo ou cancele a nota pela tela de notas fiscais.',
  },
  quota_exceeded: {
    title: 'Seus créditos de notas acabaram.',
    action: 'Compre mais créditos ou troque de plano e tente de novo.',
  },
  company_not_ready: {
    title: 'A empresa ainda não está pronta para emitir.',
    action:
      'Confira o certificado digital e os dados da empresa, depois tente de novo.',
  },
  invoice_rejected: {
    title: 'Os dados desta venda foram recusados na hora de emitir a nota.',
    action: 'Corrija os dados do cliente ou do serviço e emita de novo.',
  },
  ignored_by_user: {
    title: 'Você marcou esta venda para não emitir nota.',
    action: 'Nada a fazer.',
  },
};
