import { Injectable, type PipeTransform } from '@nestjs/common';
import { UntypedBody } from '@/modules/fiscal-core/application/invoice-routes';

/** A body whose DTO depends on the document the route reaches: validated later, by the type. */
@Injectable()
export class UntypedBodyPipe implements PipeTransform {
  transform(value: unknown): UntypedBody {
    return new UntypedBody(value);
  }
}
