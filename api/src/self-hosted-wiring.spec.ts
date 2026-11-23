/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { MODULE_METADATA } from '@nestjs/common/constants';

// Only module metadata is read here, so the fiscal SDK is replaced by an inert stand-in: any
// enum or function it is asked for exists. This keeps the spec independent of the installed SDK.
jest.mock('open-nfse', () => {
  const inert = (): unknown =>
    new Proxy(function () {}, {
      get: (_target, key) =>
        key === Symbol.toPrimitive
          ? () => 'inert'
          : key === 'then'
            ? undefined
            : inert(),
    });
  return new Proxy(
    { __esModule: true },
    {
      get: (target, key) =>
        key in target ? target[key as keyof typeof target] : inert(),
    },
  );
});

type Provider = unknown;
type Loaded = {
  billing: any;
  credits: any;
  plans: any;
  usage: any;
  alerts: any;
  worker: any;
  quota: any;
  unlimited: any;
  noopUsage: any;
  usageService: any;
  disabled: any;
  billingController: any;
  creditsController: any;
  stripeController: any;
  noopCredits: any;
  creditsRepo: any;
  lowNotifier: any;
  scheduler: any;
  abuse: any;
  assigner: any;
};

/** Loads the modules fresh with DEPLOYMENT_MODE set, because the mode is read when they are imported. */
function load(mode?: string): Loaded {
  const previous = process.env.DEPLOYMENT_MODE;
  if (mode === undefined) delete process.env.DEPLOYMENT_MODE;
  else process.env.DEPLOYMENT_MODE = mode;
  try {
    let loaded!: Loaded;
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      loaded = {
        billing: require('@/modules/billing/billing.module').BillingModule,
        credits: require('@/modules/credits/credits.module').CreditsModule,
        plans: require('@/modules/plans/plans.module').PlansModule,
        usage: require('@/modules/billing/billing-usage.module')
          .BillingUsageModule,
        alerts: require('@/modules/credits-alerts/credits-alerts.module')
          .CreditsAlertsModule,
        worker: require('@/worker-app.module').WorkerAppModule,
        quota: require('@/modules/plans/application/quota.service')
          .QuotaService,
        unlimited:
          require('@/modules/plans/application/unlimited-quota.service')
            .UnlimitedQuotaService,
        noopUsage:
          require('@/modules/billing/application/noop-billing-usage.service')
            .NoopBillingUsageService,
        usageService:
          require('@/modules/billing/application/billing-usage.service')
            .BillingUsageService,
        disabled: require('@/modules/billing/http/billing-disabled.controller')
          .BillingDisabledController,
        billingController: require('@/modules/billing/billing.controller')
          .BillingController,
        creditsController: require('@/modules/credits/http/credits.controller')
          .CreditsController,
        stripeController:
          require('@/modules/billing/http/stripe-webhook.controller')
            .StripeWebhookController,
        noopCredits:
          require('@/modules/credits/infra/noop-credit-transaction.repository')
            .NoopCreditTransactionRepository,
        creditsRepo:
          require('@/modules/credits/domain/credit-transaction.repository')
            .ICreditTransactionRepository,
        lowNotifier: require('@/modules/credits-alerts/credits-low.notifier')
          .CreditsLowNotifier,
        scheduler: require('@/modules/billing/jobs/billing.scheduler')
          .BillingScheduler,
        abuse: require('@/modules/plans/application/free-abuse-checker.service')
          .FreeAbuseChecker,
        assigner:
          require('@/modules/plans/application/self-hosted-plan-assigner.service')
            .SelfHostedPlanAssigner,
      };
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    return loaded;
  } finally {
    if (previous === undefined) delete process.env.DEPLOYMENT_MODE;
    else process.env.DEPLOYMENT_MODE = previous;
  }
}

const meta = (module: unknown, key: string): Provider[] =>
  (Reflect.getMetadata(key, module as object) ?? []) as Provider[];
const providers = (module: unknown) => meta(module, MODULE_METADATA.PROVIDERS);
const controllers = (module: unknown) =>
  meta(module, MODULE_METADATA.CONTROLLERS);
const provides = (list: Provider[], token: unknown) =>
  list.find(
    (item) =>
      item && typeof item === 'object' && (item as any).provide === token,
  ) as { useClass?: unknown } | undefined;

describe('module wiring by DEPLOYMENT_MODE', () => {
  describe('self_hosted', () => {
    const m = load('self_hosted');

    it('registers no billing, credits or webhook controller, only the 404 one', () => {
      expect(controllers(m.billing)).toEqual([m.disabled]);
      expect(controllers(m.credits)).toEqual([]);
    });

    it('swaps in the unlimited quota and the no-op usage and ledger', () => {
      expect(provides(providers(m.plans), m.quota)?.useClass).toBe(m.unlimited);
      expect(provides(providers(m.usage), m.usageService)?.useClass).toBe(
        m.noopUsage,
      );
      expect(provides(providers(m.credits), m.creditsRepo)?.useClass).toBe(
        m.noopCredits,
      );
    });

    it('registers none of the billing jobs and links tenants to the self-hosted plan', () => {
      expect(providers(m.worker)).not.toContain(m.scheduler);
      expect(providers(m.alerts)).not.toContain(m.lowNotifier);
      expect(providers(m.plans)).not.toContain(m.abuse);
      expect(meta(m.plans, MODULE_METADATA.EXPORTS)).not.toContain(m.abuse);
      expect(providers(m.plans)).toContain(m.assigner);
    });
  });

  describe.each([[undefined], ['cloud']])(
    'cloud (DEPLOYMENT_MODE=%s)',
    (mode) => {
      const m = load(mode);

      it('keeps every billing controller', () => {
        expect(controllers(m.billing)).toEqual(
          expect.arrayContaining([m.billingController, m.stripeController]),
        );
        expect(controllers(m.billing)).not.toContain(m.disabled);
        expect(controllers(m.credits)).toContain(m.creditsController);
      });

      it('keeps the real quota, usage and ledger', () => {
        expect(providers(m.plans)).toContain(m.quota);
        expect(providers(m.usage)).toContain(m.usageService);
        expect(
          provides(providers(m.credits), m.creditsRepo)?.useClass,
        ).not.toBe(m.noopCredits);
      });

      it('keeps the billing jobs and the free abuse checker', () => {
        expect(providers(m.worker)).toContain(m.scheduler);
        expect(providers(m.alerts)).toContain(m.lowNotifier);
        expect(providers(m.plans)).toContain(m.abuse);
        expect(providers(m.plans)).not.toContain(m.assigner);
      });
    },
  );
});
