import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { NfeDraft } from '../nfe-draft';
import { cardValidator } from './card.validator';
import { cfopDestinationValidator } from './cfop-destination.validator';
import { csosnValidator } from './csosn.validator';
import { ncmValidator } from './ncm.validator';
import { paymentsTotalValidator } from './payments-total.validator';
import { phase1ScopeValidator } from './phase1-scope.validator';
import { recipientIeValidator } from './recipient-ie.validator';
import { taxIdValidator } from './tax-id.validator';
import { textCharsetValidator } from './text-charset.validator';

/** In this order; the pipeline runs all of them and returns every issue at once. */
export const NFE_PRE_SEND_VALIDATORS: PreSendValidator<NfeDraft>[] = [
  taxIdValidator,
  recipientIeValidator,
  ncmValidator,
  cfopDestinationValidator,
  csosnValidator,
  paymentsTotalValidator,
  cardValidator,
  textCharsetValidator,
  phase1ScopeValidator,
];
