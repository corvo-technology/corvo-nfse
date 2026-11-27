import { Injectable } from '@nestjs/common';
import { SavedCustomerPort } from '@/modules/integrations/domain/saved-customer.port';
import { CustomerDirectory } from '../domain/customer-directory';

/** Answers the integrations module from the workspace's saved customers. */
@Injectable()
export class IntegrationSavedCustomers extends SavedCustomerPort {
  constructor(private readonly directory: CustomerDirectory) {
    super();
  }

  async find(
    tenantId: string,
    environment: 'test' | 'live',
    taxId: string,
  ): Promise<{ name: string; email: string | null } | null> {
    const saved = await this.directory.find({ tenantId, environment }, taxId);
    return saved ? { name: saved.name, email: saved.email } : null;
  }
}
