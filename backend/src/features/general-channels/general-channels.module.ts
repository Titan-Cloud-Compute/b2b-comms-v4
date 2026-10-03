import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelAccessService } from './channel-access.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

/**
 * PrismaModule and AuthModule are @Global(), so their providers (PrismaService,
 * JwtAuthGuard, RolesGuard) are available without explicit imports here.
 */
@Module({
  controllers: [ChannelsController, MessagesController],
  providers: [ChannelsService, ChannelAccessService, MessagesService],
  exports: [ChannelAccessService],
})
export class GeneralChannelsModule {}
