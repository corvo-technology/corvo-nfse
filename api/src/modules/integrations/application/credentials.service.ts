import { Injectable } from '@nestjs/common';
import { SecretsCipherService } from '@/infra/shared/secrets-cipher.service';

@Injectable()
export class CredentialsService {
  constructor(private readonly cipher: SecretsCipherService) {}

  seal(credentials: Record<string, string>): string {
    return this.cipher.encrypt(JSON.stringify(credentials));
  }

  open(sealed: string): Record<string, string> {
    return JSON.parse(this.cipher.decrypt(sealed)) as Record<string, string>;
  }
}
