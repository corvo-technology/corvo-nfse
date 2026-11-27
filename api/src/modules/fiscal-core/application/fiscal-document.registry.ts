import { Injectable } from '@nestjs/common';
import type { DocumentType } from '../domain/document-type';
import type { FiscalDocumentGateway } from '../domain/ports/gateway.port';

/** One gateway per document type; each type module registers its own on `onModuleInit`. */
@Injectable()
export class FiscalDocumentRegistry {
  private readonly gateways = new Map<
    DocumentType,
    FiscalDocumentGateway<unknown>
  >();

  register<D>(gateway: FiscalDocumentGateway<D>): void {
    if (this.gateways.has(gateway.type))
      throw new Error(`Fiscal gateway already registered for ${gateway.type}`);
    this.gateways.set(gateway.type, gateway);
  }

  get<D>(type: DocumentType): FiscalDocumentGateway<D> {
    const gateway = this.gateways.get(type);
    if (!gateway) throw new Error(`No fiscal gateway registered for ${type}`);
    return gateway;
  }

  has(type: DocumentType): boolean {
    return this.gateways.has(type);
  }
}
