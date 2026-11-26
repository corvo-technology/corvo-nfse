import { Global, Module } from '@nestjs/common';
import { FiscalDocumentRegistry } from './application/fiscal-document.registry';

@Global()
@Module({
  providers: [FiscalDocumentRegistry],
  exports: [FiscalDocumentRegistry],
})
export class FiscalCoreModule {}
