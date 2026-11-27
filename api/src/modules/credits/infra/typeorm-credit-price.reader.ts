import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CreditPriceReader } from '@/modules/fiscal-core/domain/credit-price';
import type { DocumentType } from '@/modules/fiscal-core/domain/document-type';
import { DocumentCreditPriceOrmEntity } from './document-credit-price.orm-entity';

/** Reads the price at the moment of the reservation; no cache, so a price change applies at once. */
@Injectable()
export class TypeormCreditPriceReader implements CreditPriceReader {
  constructor(
    @InjectRepository(DocumentCreditPriceOrmEntity)
    private readonly prices: Repository<DocumentCreditPriceOrmEntity>,
  ) {}

  async priceOf(type: DocumentType): Promise<number> {
    const row = await this.prices.findOne({ where: { documentType: type } });
    if (!row) throw new Error(`No credit price configured for ${type}`);
    return row.credits;
  }
}
