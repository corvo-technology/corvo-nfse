/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-argument */
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DuplicatePendingInvitationError } from '../domain/errors';
import { permissionsForTenantRole } from '../domain/permission';
import {
  InviteProfessionalInput,
  TenantInvitation,
} from '../domain/tenant-invitation';
import { ITenantInvitationRepository } from '../domain/tenant-invitation.repository';
import { AuthUserService } from './auth-user.service';

@Injectable()
export class InvitationService {
  constructor(
    private readonly invitationRepository: ITenantInvitationRepository,
    private readonly authUserService: AuthUserService,
  ) {}

  async invite(input: InviteProfessionalInput): Promise<{
    invitation: TenantInvitation;
  }> {
    const email = input.email.trim().toLowerCase();

    // Check for existing pending invitation
    const existingPending =
      await this.invitationRepository.findPendingByEmailAndTenant(
        email,
        input.tenantId,
      );
    if (existingPending) {
      throw new DuplicatePendingInvitationError();
    }

    // Create or get user (no password — invitee receives magic link)
    await this.authUserService.createUser({
      email,
      name: input.name,
    });

    // Create invitation
    const role = input.role ?? 'developer';
    const permissions = permissionsForTenantRole(role);
    const now = new Date();

    const invitation = await this.invitationRepository.save(
      {
        id: crypto.randomUUID(),
        tenantId: input.tenantId,
        email,
        name: input.name,
        role,
        permissions,
        status: 'pending',
        expiresAt:
          input.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      },
      input.tenantId,
    );

    return { invitation };
  }

  async listByTenant(tenantId: string): Promise<TenantInvitation[]> {
    // Use the repository's listByTenant method
    const result = await this.invitationRepository.listByTenant(tenantId);
    return result;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const invitation = await this.invitationRepository.findByIdAndTenantId(
      id,
      tenantId,
    );
    if (!invitation) throw new NotFoundException('Invitation not found');
    await this.invitationRepository.update(
      {
        ...invitation,
        status: 'revoked',
        updatedAt: new Date(),
      },
      tenantId,
    );
  }
  private generateTempPassword(): string {
    return randomBytes(16).toString('hex');
  }
}
