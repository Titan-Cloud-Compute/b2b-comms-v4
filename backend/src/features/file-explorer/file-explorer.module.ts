import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { FileExplorerController } from './file-explorer.controller';
import { FileExplorerService } from './file-explorer.service';

/** File explorer: folders / files / file_versions with project-membership authz. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [FileExplorerController],
  providers: [FileExplorerService],
})
export class FileExplorerModule {}
