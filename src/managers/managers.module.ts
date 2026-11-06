import { Module } from '@nestjs/common';
import { ManagersService } from './managers.service';

@Module({
  providers: [ManagersService],
  exports: [ManagersService],
})
export class ManagersModule {}
