import { WebhookOutboxService } from './webhook-outbox.service';
import { WebhookDeliveryHttpError } from '../infra/webhook-dispatcher.adapter';
import { WebhookEvent } from '../domain/webhook-event';

describe('WebhookOutboxService - NFS-e Events', () => {
  const baseDelivery = {
    id: 'delivery-nfse-1',
    tenantId: 'tenant-1',
    webhookConfigId: 'config-1',
    eventType: 'nfse.invoice.authorized',
    environment: 'live' as const,
    url: 'https://example.test/webhooks/nfse',
    status: 'pending' as const,
    retryCount: 0,
    nextRetryAt: new Date(),
    createdAt: new Date(),
  };

  const nfseAuthorizedEvent: WebhookEvent = {
    id: 'evt-nfse-1',
    type: 'nfse.invoice.authorized',
    environment: 'live',
    createdAt: new Date().toISOString(),
    data: {
      accessKey: 'NFSE123456',
      nfseNumber: 100,
      companyId: 'company-1',
      xmlAuthorized: '<xml/>',
    },
  };

  const nfseRejectedEvent: WebhookEvent = {
    id: 'evt-nfse-2',
    type: 'nfse.invoice.rejected',
    environment: 'live',
    createdAt: new Date().toISOString(),
    data: {
      accessKey: 'NFSE123456',
      errorCode: 'E001',
      errorMessage: 'CNPJ inválido',
    },
  };

  const nfseReconciliationRequiredEvent: WebhookEvent = {
    id: 'evt-nfse-3',
    type: 'nfse.invoice.reconciliation_required',
    environment: 'live',
    createdAt: new Date().toISOString(),
    data: {
      accessKey: 'NFSE123456',
      pendingId: 'pending-123',
      reason: 'Timeout - retry later',
    },
  };

  function buildService(
    overrides: {
      repo?: {
        update: jest.Mock;
        findPendingDeliveries?: jest.Mock;
        claimDelivery?: jest.Mock;
        save?: jest.Mock;
        findByIdAndTenantId?: jest.Mock;
      };
      adapter?: { sign: jest.Mock; send: jest.Mock };
      secrets?: { findSecret: jest.Mock };
    } = {},
  ) {
    const repo = overrides.repo ?? {
      update: jest.fn(),
      findPendingDeliveries: jest.fn(),
      claimDelivery: jest.fn().mockResolvedValue(true),
      save: jest
        .fn()
        .mockImplementation((delivery) => Promise.resolve(delivery)),
      findByIdAndTenantId: jest.fn(),
    };
    const adapter = overrides.adapter ?? {
      sign: jest.fn().mockReturnValue('signature'),
      send: jest.fn().mockResolvedValue({ statusCode: 204 }),
    };
    const secrets = overrides.secrets ?? {
      findSecret: jest.fn().mockResolvedValue('test-secret'),
    };
    const service = new WebhookOutboxService(
      {
        visit: async (_kind: string, work: (id: string) => Promise<void>) =>
          work('tenant-1'),
      } as never,
      repo as never,
      adapter,
      secrets,
    );
    return { service, repo, adapter, secrets };
  }

  describe('enqueue', () => {
    it('enqueues NFS-e authorized event successfully', async () => {
      const savedDelivery = { ...baseDelivery, id: expect.any(String) };
      const { service, repo } = buildService({
        repo: {
          save: jest.fn().mockResolvedValue(savedDelivery),
          update: jest.fn(),
          findPendingDeliveries: jest.fn(),
          findByIdAndTenantId: jest.fn(),
        },
      });

      const result = await service.enqueue({
        tenantId: 'tenant-1',
        webhookConfigId: 'config-1',
        eventType: 'nfse.invoice.authorized',
        environment: 'live',
        url: 'https://example.test/webhooks/nfse',
        payload: nfseAuthorizedEvent,
        secret: 'secret-123',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'nfse.invoice.authorized',
          payload: nfseAuthorizedEvent,
          status: 'pending',
        }),
        'tenant-1',
      );
      expect(result.id).toBeDefined();
    });

    it('enqueues NFS-e rejected event successfully', async () => {
      const { service, repo } = buildService();

      await service.enqueue({
        tenantId: 'tenant-1',
        webhookConfigId: 'config-1',
        eventType: 'nfse.invoice.rejected',
        environment: 'live',
        url: 'https://example.test/webhooks/nfse',
        payload: nfseRejectedEvent,
        secret: 'secret-123',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'nfse.invoice.rejected',
          payload: nfseRejectedEvent,
        }),
        'tenant-1',
      );
    });

    it('enqueues NFS-e reconciliation_required event successfully', async () => {
      const { service, repo } = buildService();

      await service.enqueue({
        tenantId: 'tenant-1',
        webhookConfigId: 'config-1',
        eventType: 'nfse.invoice.reconciliation_required',
        environment: 'live',
        url: 'https://example.test/webhooks/nfse',
        payload: nfseReconciliationRequiredEvent,
        secret: 'secret-123',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'nfse.invoice.reconciliation_required',
          payload: nfseReconciliationRequiredEvent,
        }),
        'tenant-1',
      );
    });
  });

  describe('attemptDelivery', () => {
    it('records success status code after successful NFS-e delivery', async () => {
      const { service, repo } = buildService({
        adapter: {
          sign: jest.fn().mockReturnValue('signature'),
          send: jest.fn().mockResolvedValue({ statusCode: 204 }),
        },
      });

      await service.attemptDelivery(
        baseDelivery,
        nfseAuthorizedEvent,
        'test-secret',
      );

      expect(repo.update).toHaveBeenCalledWith(
        'delivery-nfse-1',
        'tenant-1',
        expect.objectContaining({
          status: 'sent',
          statusCode: 204,
        }),
      );
    });

    it('schedules retry after HTTP error on NFS-e webhook', async () => {
      const { service, repo } = buildService({
        adapter: {
          sign: jest.fn().mockReturnValue('signature'),
          send: jest.fn().mockRejectedValue(new WebhookDeliveryHttpError(503)),
        },
      });

      await service.attemptDelivery(
        baseDelivery,
        nfseAuthorizedEvent,
        'test-secret',
      );

      expect(repo.update).toHaveBeenCalledWith(
        'delivery-nfse-1',
        'tenant-1',
        expect.objectContaining({
          status: 'delayed',
          statusCode: 503,
          retryCount: 1,
        }),
      );
    });

    it('uses the payload data for NFS-e event signing', async () => {
      const { service, adapter } = buildService();

      await service.attemptDelivery(
        baseDelivery,
        nfseAuthorizedEvent,
        'test-secret',
      );

      expect(adapter.sign).toHaveBeenCalledWith(
        nfseAuthorizedEvent,
        'test-secret',
      );
    });
  });

  describe('processNext', () => {
    it('processes pending NFS-e deliveries in order', async () => {
      const dueDeliveries = [
        { ...baseDelivery, id: 'del-1', payload: nfseAuthorizedEvent },
        { ...baseDelivery, id: 'del-2', payload: nfseRejectedEvent },
      ];

      const { service, repo, adapter, secrets } = buildService({
        repo: {
          save: jest.fn(),
          update: jest.fn(),
          claimDelivery: jest.fn().mockResolvedValue(true),
          findPendingDeliveries: jest.fn().mockResolvedValue(dueDeliveries),
          findByIdAndTenantId: jest.fn(),
        },
        adapter: {
          sign: jest.fn().mockReturnValue('signature'),
          send: jest.fn().mockResolvedValue({ statusCode: 204 }),
        },
      });

      await service.processNext();

      expect(repo.findPendingDeliveries).toHaveBeenCalledTimes(1);
      expect(secrets.findSecret).toHaveBeenCalledWith('tenant-1', 'config-1');
      expect(adapter.send).toHaveBeenCalledTimes(2);
    });

    it('skips deliveries without payload for NFS-e events', async () => {
      const dueDeliveries = [
        { ...baseDelivery }, // no payload
      ];

      const { service, secrets } = buildService({
        repo: {
          save: jest.fn(),
          update: jest.fn(),
          claimDelivery: jest.fn().mockResolvedValue(true),
          findPendingDeliveries: jest.fn().mockResolvedValue(dueDeliveries),
          findByIdAndTenantId: jest.fn(),
        },
      });

      await service.processNext();

      expect(secrets.findSecret).not.toHaveBeenCalled();
    });
  });
});
