import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  Body,
  Controller,
  HttpCode,
  Delete,
  Get,
  Query,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '@/infra/openapi/swagger';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { AuthContext } from '@/modules/auth/auth-context';
import { data } from '@/shared/http/response';
import { AuthContextService } from '../application/auth-context.service';
import { MembershipService } from '../application/membership.service';
import { TENANT_PERMISSION_CATEGORY_CATALOG } from '../domain/permission';
import { InviteMemberDto } from './invite-member.dto';
import { InviteMemberService } from '../application/invite-member.service';
import { RequirePermission } from '../require-permission.decorator';

@Controller('auth')
@ApiTags('Auth')
@ApiErrorResponses()
export class AuthController {
  constructor(
    private readonly authContextService: AuthContextService,
    private readonly membershipService: MembershipService,
    private readonly inviteMemberService: InviteMemberService,
  ) {}

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  logout(@Req() req: RequestWithAuthContext) {
    const sessionId = req.authContext?.sessionId;
    if (!sessionId) throw new UnauthorizedException('Session is required');
    return data({ loggedOut: true });
  }

  @Get('me')
  @ApiBearerAuth()
  async getMe(@Req() req: RequestWithAuthContext) {
    const authContext: AuthContext = req.authContext!;
    return data(
      await this.authContextService.buildForAuthUser(
        authContext.authUserId,
        authContext.productKey,
        authContext.activeTenantId,
      ),
    );
  }

  @Get('memberships')
  @ApiBearerAuth()
  @ApiCursorResponse()
  async getMemberships(
    @Req() req: RequestWithAuthContext,
    @Query() options: CursorQuery,
  ) {
    const authContext: AuthContext = req.authContext!;
    return this.membershipService.listPage(authContext.activeTenantId, options);
  }

  @Get('permissions')
  @ApiBearerAuth()
  getPermissions() {
    return data({ categories: TENANT_PERMISSION_CATEGORY_CATALOG });
  }

  @Post('invite')
  @ApiBearerAuth()
  @RequirePermission('settings.manage')
  async inviteMember(
    @Req() req: RequestWithAuthContext,
    @Body() dto: InviteMemberDto,
  ) {
    const authContext = req.authContext!;
    return data(
      await this.inviteMemberService.invite(authContext.activeTenantId, dto),
    );
  }

  @Get('members')
  @ApiBearerAuth()
  @RequirePermission('settings.manage')
  @ApiCursorResponse()
  async listMembers(
    @Req() req: RequestWithAuthContext,
    @Query() options: CursorQuery,
  ) {
    const authContext = req.authContext!;
    return this.inviteMemberService.listMembersPage(
      authContext.activeTenantId,
      options,
    );
  }

  @Delete('members/:id')
  @ApiBearerAuth()
  @RequirePermission('settings.manage')
  async removeMember(
    @Req() req: RequestWithAuthContext,
    @Param('id') id: string,
  ) {
    const authContext = req.authContext!;
    await this.inviteMemberService.removeMember(authContext.activeTenantId, id);
    return data({ deleted: true });
  }
}
