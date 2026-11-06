import { Module } from '@nestjs/common';
import { PenaltyEngineService } from './penalty-engine.service';

@Module({
  providers: [PenaltyEngineService],
  exports: [PenaltyEngineService],
})
export class PenaltyEngineModule {}
