import type { Connector, ConnectorManifest } from './connector';

const ID_PATTERN = /^[a-z0-9-]+$/;

export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  register(connector: Connector): void {
    const { id } = connector.manifest;
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid connector id: ${id}`);
    if (this.connectors.has(id))
      throw new Error(`Connector ${id} is already registered`);
    this.connectors.set(id, connector);
  }

  get(id: string): Connector {
    const connector = this.connectors.get(id);
    if (!connector) throw new Error(`Unknown connector: ${id}`);
    return connector;
  }

  has(id: string): boolean {
    return this.connectors.has(id);
  }

  manifests(): ConnectorManifest[] {
    return [...this.connectors.values()].map((c) => c.manifest);
  }
}
