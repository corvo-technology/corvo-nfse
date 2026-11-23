import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

/** A company and its monthly-package settings. */
export interface AccountantCompany {
  id: string;
  tenantId: string;
  name: string;
  environment: ExecutionEnvironment;
  /** Null = the monthly send is off. */
  accountantEmail: string | null;
  /** YYYY-MM of the last package sent. */
  lastSentMonth: string | null;
}

export abstract class IAccountantPackageRepository {
  abstract find(
    tenantId: string,
    companyId: string,
    environment: ExecutionEnvironment,
  ): Promise<AccountantCompany | null>;
  /** Live companies of the workspace with an accountant e-mail. */
  abstract listEnabled(tenantId: string): Promise<AccountantCompany[]>;
  abstract setEmail(
    tenantId: string,
    companyId: string,
    email: string | null,
  ): Promise<void>;
  /**
   * Marks `month` as sent. Without `force` it succeeds only if the month was not already
   * marked, in one statement: two runs at once cannot both win.
   */
  abstract claimMonth(
    tenantId: string,
    companyId: string,
    month: string,
    force: boolean,
  ): Promise<boolean>;
  abstract setLastSentMonth(
    tenantId: string,
    companyId: string,
    month: string | null,
  ): Promise<void>;
}
