import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { RegistrationLookup } from './nfe-registration';

/** Asks the SEFAZ "Consulta Cadastro" what state registrations a company has. Never throws. */
export abstract class ICadastroLookup {
  abstract lookup(
    companyId: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    uf: Uf,
    cnpj: string,
  ): Promise<RegistrationLookup>;
}
