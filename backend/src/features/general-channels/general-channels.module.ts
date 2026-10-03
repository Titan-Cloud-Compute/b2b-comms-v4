import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelAccessService } from './channel-access.service';

/**
 * PrismaModule and AuthModule are @Global(), so their providers (PrismaService,
 * JwtAuthGuard, RolesGuard) are available without explicit imports here.
 */
@Module({
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelAccessService],
  exports: [ChannelAccessService],
})
export class GeneralChannelsModule {}
