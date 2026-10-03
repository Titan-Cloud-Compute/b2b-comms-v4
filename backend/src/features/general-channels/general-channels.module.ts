import { Module } from '@nestjs/common';
import { ChannelAccessPolicy } from './channel-access.policy';
import { ChannelsController } from './channels.controller';
import { MessagesController } from './messages.controller';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

/** Story: General Channels — channels, messages and the real-time feed. */
@Module({
  controllers: [ChannelsController, MessagesController, RealtimeController],
  providers: [ChannelAccessPolicy, RealtimeService],
  exports: [ChannelAccessPolicy, RealtimeService],
})
export class GeneralChannelsModule {}
