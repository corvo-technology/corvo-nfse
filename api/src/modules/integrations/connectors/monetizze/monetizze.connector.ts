import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ConnectorDataError,
  type CommercialState,
  type Connector,
  type ConnectionView,
  type DeliveryAuth,
  type InboundRequest,
  type IntegrationEnvironment,
  type NormalizedOperation,
  type OperationDelivery,
  type ParsedDelivery,
} from '../../domain/connector';
import {
  brasiliaDate,
  codeOf,
  moneyCents,
  readBody,
  readCustomer,
  section,
  text,
  type MonetizzeBody,
} from './monetizze.payload';

/**
 * `venda.codigo_status` (documented enumeration): 2 Finalizada/Aprovada and 6 Completa are a paid sale;
 * 4 Devolvida is a refund. 1 Aguardando, 3 Cancelada (never paid), 5 Bloqueada and the rest are ignored.
 */
const STATUS_STATE: Record<number, CommercialState> = {
  2: 'paid',
  6: 'paid',
  4: 'refunded',
};
/** `tipoPostback.codigo`: 2 Produtor and 3 Co-Produtor receive the buyer and the sale; the rest are not the invoice issuer. */
const ISSUER_ROLES = new Set([2, 3]);
const SHARE_OPTION = 'mine';
const OPTIONS = ['total', SHARE_OPTION];

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The status code of the sale; `tipoEvento` is the fallback when the sale block has none. */
function statusOf(body: MonetizzeBody): number | null {
  return (
    codeOf(section(body, 'venda').codigo_status) ??
    codeOf(section(body, 'tipoEvento').codigo)
  );
}

/**
 * Sales on a Monetizze producer account. Monetizze has no signature: the postback carries the account's
 * "chave única" in the body (`chave_unica`), and the URL secret of the connection is checked as well.
 * Form-encoded (as the official PHP example reads it) or JSON. Read-only: everything is in the postback.
 */
@Injectable()
export class MonetizzeConnector implements Connector {
  readonly manifest = {
    id: 'monetizze',
    name: 'Monetizze',
    version: '1',
    credentialFields: [
      {
        key: 'chaveUnica',
        label: 'Chave única',
        secret: true,
      },
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        secret: true,
        generate: true,
        inWebhookUrl: true,
      },
      {
        key: 'invoiceValue',
        label: 'Valor da nota',
        secret: false,
        optional: true,
        options: OPTIONS,
      },
    ],
    webhookInstructions: {
      pt: 'Passo 1: na Monetizze, vá em Ferramentas > Postback, clique em cadastrar e escolha o tipo "Postback (server to server)", formato JSON se houver a opção. Cole o endereço acima em "URL" e selecione os produtos. Passo 2: copie a "Chave única" (no fim da mesma tela) e cole no campo "Chave única" aqui. Passo 3: marque os eventos Finalizada/Aprovada, Completa e Devolvida e salve. Atenção: o CPF/CNPJ do comprador só chega para o produtor e o coprodutor, e só se o checkout pedir esse dado; sem ele a venda vai para "completar dados".',
      en: 'Step 1: in Monetizze, go to Ferramentas (Tools) > Postback, click to register and choose the type "Postback (server to server)", JSON format if offered. Paste the address above in "URL" and select the products. Step 2: copy the "Chave única" (unique key, at the bottom of the same screen) and paste it in the "Chave única" field here. Step 3: tick the events Finalizada/Aprovada, Completa and Devolvida and save. Note: the buyer tax ID only reaches the producer and co-producer, and only if the checkout asks for it; without it the sale goes to "complete data".',
    },
    webhookEvents: ['Finalizada/Aprovada', 'Completa', 'Devolvida'],
    supportedFlows: ['sale'],
  };

  authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth> {
    return Promise.resolve(this.check(req, connection));
  }

  private check(req: InboundRequest, connection: ConnectionView): DeliveryAuth {
    const urlSecret = req.query.webhookSecret;
    const knownSecret = connection.credentials.webhookSecret;
    if (!urlSecret || !knownSecret || !sameText(urlSecret, knownSecret))
      return { ok: false, reason: 'bad_secret' };
    let sent: string | null;
    try {
      sent = text(readBody(req.rawBody).chave_unica);
    } catch {
      return { ok: false, reason: 'bad_body' };
    }
    if (!sent) return { ok: false, reason: 'missing_chave_unica' };
    const expected = connection.credentials.chaveUnica;
    return expected && sameText(sent, expected)
      ? { ok: true }
      : { ok: false, reason: 'bad_chave_unica' };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    const sale = section(body, 'venda');
    const code = text(sale.codigo);
    // No sale code means a recovered cart (abandoned checkout), not a sale.
    if (!code) return { kind: 'ignored', externalType: 'no_sale' };
    const status = statusOf(body);
    const externalType = `status_${status ?? 'unknown'}`;
    const state = status === null ? undefined : STATUS_STATE[status];
    if (!state) return { kind: 'ignored', externalType };
    const role = codeOf(section(body, 'tipoPostback').codigo);
    if (role !== null && !ISSUER_ROLES.has(role))
      return { kind: 'ignored', externalType: `${externalType}:not_producer` };
    return {
      kind: 'operation',
      deliveryId: `${code}:${status}`,
      externalType,
    };
  }

  normalize(input: {
    connection: ConnectionView;
    payload: unknown;
    delivery: OperationDelivery;
  }): Promise<NormalizedOperation> {
    try {
      return Promise.resolve(
        this.toOperation(
          readBody(Buffer.from(String(input.payload), 'utf8')),
          input.connection.credentials.invoiceValue,
        ),
      );
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  private toOperation(
    body: MonetizzeBody,
    invoiceValue: string | undefined,
  ): NormalizedOperation {
    const sale = section(body, 'venda');
    const status = statusOf(body);
    const state = status === null ? undefined : STATUS_STATE[status];
    if (!state) throw new ConnectorDataError('Not a Monetizze sale event');
    const code = text(sale.codigo);
    if (!code)
      throw new ConnectorDataError('Monetizze event has no venda.codigo');
    const subscription = text(section(body, 'assinatura').codigo);
    const externalRefs: Record<string, string> = {
      venda: code,
      ...(subscription ? { assinatura: subscription } : {}),
    };
    const operationKey = `monetizze:${code}`;
    const total = moneyCents(sale.valor);
    const started = brasiliaDate(sale.dataInicio);
    const finished = brasiliaDate(sale.dataFinalizada);

    if (state !== 'paid')
      // A refund names the sale: the handler swaps in that sale's own data.
      return {
        operationKey,
        commercialState: state,
        externalRefs,
        refersTo: { ref: 'venda', value: code },
        occurredAt: new Date(),
        paidAt: null,
        currency: 'BRL',
        amountCents: total ?? 0,
        discountCents: 0,
        customer: null,
        items: [],
        description: null,
        sellerIssuesInvoice: true,
      };

    const useMyShare = invoiceValue === SHARE_OPTION;
    const amount = useMyShare ? moneyCents(sale.valorRecebido) : total;
    if (!amount || amount <= 0)
      throw new ConnectorDataError(
        useMyShare
          ? 'Monetizze did not send venda.valorRecebido (the producer share): complete the sale by hand'
          : 'Monetizze venda.valor is not a positive amount',
      );
    const product = section(body, 'produto');
    const productId = text(product.codigo);
    const name = text(product.nome);
    const paidAt = finished ?? started ?? new Date();
    return {
      operationKey,
      commercialState: 'paid',
      externalRefs,
      occurredAt: paidAt,
      paidAt,
      currency: 'BRL',
      amountCents: amount,
      discountCents: 0,
      customer: readCustomer(body),
      items: [{ externalProductId: productId, description: name, quantity: 1 }],
      description: name,
      sellerIssuesInvoice: true,
    };
  }

  /** Monetizze names nothing about the account: the id comes from the connection itself, so rotating the key keeps it. */
  validateConnection(
    credentials: Record<string, string>,
    _environment: IntegrationEnvironment,
    connection: { publicId: string },
  ): Promise<{ externalAccountId: string }> {
    if (!credentials.chaveUnica?.trim())
      return Promise.reject(new ConnectorDataError('Monetizze key is empty'));
    if (credentials.invoiceValue && !OPTIONS.includes(credentials.invoiceValue))
      return Promise.reject(
        new ConnectorDataError('invoiceValue must be total or mine'),
      );
    const digest = createHash('sha256')
      .update(connection.publicId)
      .digest('hex');
    return Promise.resolve({
      externalAccountId: `monetizze:${digest.slice(0, 24)}`,
    });
  }
}
