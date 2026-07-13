import { Body, Controller, Get, Post, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { GroupCleanupService } from './group-cleanup.service';

class TestKeywordDto {
  text!: string;
}

@ApiTags('moderation')
@Controller('moderation')
export class ModerationController {
  constructor(private readonly groupCleanup: GroupCleanupService) {}

  @Get('group-cleanup/status')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Get group keyword auto-cleanup status' })
  @ApiResponse({ status: 200, description: 'Group cleanup configuration status' })
  getStatus() {
    return this.groupCleanup.getPublicStatus();
  }

  @Post('group-cleanup/test')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Test whether a message body would match cleanup keywords (no delete)' })
  test(@Body() body: TestKeywordDto) {
    const text = body?.text?.trim();
    if (!text) throw new BadRequestException('text is required');
    if (text.length > 4000) throw new BadRequestException('text too long (max 4000)');
    return this.groupCleanup.testMatch(text);
  }
}
