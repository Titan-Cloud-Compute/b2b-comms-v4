import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChannelsController, ChannelMessagesController, MessageController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelAccessService } from './channel-access.service';
import { MessagesService } from './messages.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ChannelsController, ChannelMessagesController, MessageController],
  providers: [ChannelsService, ChannelAccessService, MessagesService],
  exports: [ChannelAccessService],
})
export class GeneralChannelsModule {}
