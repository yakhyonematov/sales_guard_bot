import { Module } from '@nestjs/common';
import { ViolationsService } from './violations.service';
import { PenaltyEngineModule } from '../penalty-engine/penalty-engine.module';

@Module({
  imports: [PenaltyEngineModule],
  providers: [ViolationsService],
  exports: [ViolationsService],
})
export class ViolationsModule {}
