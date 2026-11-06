import { Module } from '@nestjs/common';
import { ClausesService } from './clauses.service';

@Module({
  providers: [ClausesService],
  exports: [ClausesService],
})
export class ClausesModule {}
