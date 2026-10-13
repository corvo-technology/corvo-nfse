import { getMetadataArgsStorage } from 'typeorm';
import { WebhookConfigEntity } from './webhook-config.orm-entity';

describe(WebhookConfigEntity.name, () => {
  it('maps events to PostgreSQL text[] rather than a comma-separated simple array', () => {
    const column = getMetadataArgsStorage().columns.find(
      (metadata) =>
        metadata.target === WebhookConfigEntity &&
        metadata.propertyName === 'events',
    );

    expect(column?.options.type).toBe('text');
    expect(column?.options.array).toBe(true);
  });
});
