import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

/** Message references: one annotated PDF/image page pinned to a file version, per chat message. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ReferencesController],
  providers: [ReferencesService],
})
export class MessageReferenceAndAnnotationModule {}
