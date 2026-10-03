import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChannelsController } from './channels.controller';
import { MessagesController, MessageActionsController } from './messages.controller';
import { ChannelsService } from './channels.service';
import { ChannelAccessService } from './channel-access.service';
import { MessagesService } from './messages.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ChannelsController, MessagesController, MessageActionsController],
  providers: [ChannelsService, ChannelAccessService, MessagesService],
  exports: [ChannelAccessService],
})
export class GeneralChannelsModule {}
