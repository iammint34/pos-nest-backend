import { Module } from '@nestjs/common';
import { BirService } from './bir.service';
import { BirController } from './bir.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BirController],
  providers: [BirService],
  exports: [BirService],
})
export class BirModule {}
