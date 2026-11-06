import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PenaltyEngineModule } from './penalty-engine/penalty-engine.module';
import { ViolationsModule } from './violations/violations.module';
import { StatsModule } from './stats/stats.module';
import { UsersModule } from './users/users.module';
import { RopsModule } from './rops/rops.module';
import { ManagersModule } from './managers/managers.module';
import { ClausesModule } from './clauses/clauses.module';
import { ScalesModule } from './scales/scales.module';
import { TelegramBotModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    NotificationsModule,
    PenaltyEngineModule,
    ViolationsModule,
    StatsModule,
    UsersModule,
    RopsModule,
    ManagersModule,
    ClausesModule,
    ScalesModule,
    TelegramBotModule,
  ],
})
export class AppModule {}
