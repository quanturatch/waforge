import { Module, forwardRef } from '@nestjs/common';
import { AiAutoReplyService } from './ai-auto-reply.service';
import { AiController } from './ai.controller';
import { MessageModule } from '../message/message.module';

@Module({
  imports: [forwardRef(() => MessageModule)],
  controllers: [AiController],
  providers: [AiAutoReplyService],
  exports: [AiAutoReplyService],
})
export class AiModule {}
