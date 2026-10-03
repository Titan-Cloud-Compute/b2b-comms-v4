import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChannelsController, ChannelMessagesController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelAccessService } from './channel-access.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ChannelsController, ChannelMessagesController],
  providers: [ChannelsService, ChannelAccessService],
  exports: [ChannelAccessService],
})
export class GeneralChannelsModule {}
