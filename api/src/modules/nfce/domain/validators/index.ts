import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import { cfopDestinationValidator } from '@/modules/nfe/domain/validators/cfop-destination.validator';
import { csosnValidator } from '@/modules/nfe/domain/validators/csosn.validator';
import { ncmValidator } from '@/modules/nfe/domain/validators/ncm.validator';
import { paymentsTotalValidator } from '@/modules/nfe/domain/validators/payments-total.validator';
import { phase1ScopeValidator } from '@/modules/nfe/domain/validators/phase1-scope.validator';
import { taxIdValidator } from '@/modules/nfe/domain/validators/tax-id.validator';
import { textCharsetValidator } from '@/modules/nfe/domain/validators/text-charset.validator';
import type { NfeDraft } from '@/modules/nfe/domain/nfe-draft';
import { cardValidator } from './card.validator';
import { consumerIdValidator } from './consumer-id.validator';
import { deliveryAddressValidator } from './delivery-address.validator';
import { indPresValidator } from './ind-pres.validator';
import { nfceScopeValidator } from './nfce-scope.validator';

/**
 * The NF-e validators that hold for the NFC-e (tax id only when there is a CPF/CNPJ; no `dest` IE
 * rule: the consumer is never a contributor) plus the NFC-e ones. All run; every issue is returned.
 */
export const NFCE_PRE_SEND_VALIDATORS: PreSendValidator<NfeDraft>[] = [
  taxIdValidator,
  ncmValidator,
  cfopDestinationValidator,
  csosnValidator,
  paymentsTotalValidator,
  textCharsetValidator,
  phase1ScopeValidator,
  indPresValidator,
  deliveryAddressValidator,
  consumerIdValidator,
  cardValidator,
  nfceScopeValidator,
];
