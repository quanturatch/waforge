import { Module, forwardRef } from '@nestjs/common';
import { GroupCleanupService } from './group-cleanup.service';
import { ModerationController } from './moderation.controller';
import { MessageModule } from '../message/message.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [forwardRef(() => MessageModule), forwardRef(() => SessionModule)],
  controllers: [ModerationController],
  providers: [GroupCleanupService],
  exports: [GroupCleanupService],
})
export class ModerationModule {}
