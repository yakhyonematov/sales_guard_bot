import { Module } from '@nestjs/common';
import { ScalesService } from './scales.service';
import { PenaltyEngineModule } from '../penalty-engine/penalty-engine.module';

@Module({
  imports: [PenaltyEngineModule],
  providers: [ScalesService],
  exports: [ScalesService],
})
export class ScalesModule {}
