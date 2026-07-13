import { Body, Controller, Get, Post, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { AiAutoReplyService } from './ai-auto-reply.service';
import { DEFAULT_MODELS, LlmProviderId } from './llm/llm.types';
import { isLlmProviderId } from './llm/llm.providers';

class TestAiDto {
  text!: string;
}

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiAutoReplyService) {}

  @Get('status')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Get AI auto-reply status (no secrets)' })
  @ApiResponse({ status: 200, description: 'AI configuration status' })
  getStatus() {
    return {
      ...this.ai.getPublicStatus(),
      providers: (['openai', 'anthropic', 'grok', 'gemini'] as LlmProviderId[]).map(id => ({
        id,
        defaultModel: DEFAULT_MODELS[id],
      })),
    };
  }

  @Post('test')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Send a one-off prompt to the configured LLM (does not send WhatsApp)' })
  async test(@Body() body: TestAiDto) {
    const text = body?.text?.trim();
    if (!text) throw new BadRequestException('text is required');
    if (text.length > 4000) throw new BadRequestException('text too long (max 4000)');
    try {
      return await this.ai.testPrompt(text);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
  }

  @Get('providers')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'List supported LLM providers' })
  listProviders() {
    return {
      providers: (['openai', 'anthropic', 'grok', 'gemini'] as LlmProviderId[]).map(id => ({
        id,
        defaultModel: DEFAULT_MODELS[id],
        valid: isLlmProviderId(id),
      })),
    };
  }
}
