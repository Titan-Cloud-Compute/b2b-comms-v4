import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActiveQuestionChatsController } from './active-question-chats.controller';
import { ActiveQuestionChatsService } from './active-question-chats.service';
import { QuestionMessageGuard } from './question-message.guard';

/** Active question chats: channels(kind="question") + two-sided question_resolutions. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ActiveQuestionChatsController],
  providers: [
    ActiveQuestionChatsService,
    { provide: APP_INTERCEPTOR, useClass: QuestionMessageGuard },
  ],
})
export class ActiveQuestionChatsModule {}
