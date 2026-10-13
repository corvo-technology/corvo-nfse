import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthOAuthClientOrmEntity } from '@/infra/persistence/typeorm/entities/auth.orm-entities';

@Module({
  imports: [TypeOrmModule.forFeature([AuthOAuthClientOrmEntity])],
})
export class AuthOauthModule implements OnModuleInit {
  private readonly logger = new Logger(AuthOauthModule.name);

  constructor(
    @InjectRepository(AuthOAuthClientOrmEntity)
    private readonly clientRepo: Repository<AuthOAuthClientOrmEntity>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redirectUris = (this.config.get<string>('MCP_REDIRECT_URIS') ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    await this.clientRepo.upsert(
      {
        id: 'corvo-mcp',
        name: 'Corvo AI Integration',
        redirectUris,
        scopes: ['nfse:read', 'nfse:write'],
        isFirstParty: true,
        isActive: true,
        tokenEndpointAuthMethod: 'none',
        grantTypes: ['authorization_code'],
      },
      { conflictPaths: ['id'] },
    );
    this.logger.log('OAuth client corvo-mcp seeded');
  }
}
