import { Module } from '@nestjs/common';
import { RopsService } from './rops.service';

@Module({
  providers: [RopsService],
  exports: [RopsService],
})
export class RopsModule {}
