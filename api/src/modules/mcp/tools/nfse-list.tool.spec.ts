import { INVOICE_STATUSES } from '@/modules/invoice/domain/invoice-status';
import { NFSE_LIST_TOOL } from './nfse-list.tool';

describe('nfse_list tool', () => {
  it('documents every invoice status in the status filter', () => {
    const description =
      NFSE_LIST_TOOL.inputSchema.properties.status.description;
    for (const status of INVOICE_STATUSES)
      expect(description).toContain(status);
    expect(description).toContain('cancelling');
    expect(description).toContain('cancelled');
  });
});
