import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaSessionMiddleware } from './session/prisma-session.middleware';
import { createAuthMiddleware } from './guards/auth.middleware';
import { TelegramUpdate } from './telegram.update';
import { ViolationWizard } from './scenes/violation.wizard';
import { RopsModule } from '../rops/rops.module';
import { ManagersModule } from '../managers/managers.module';
import { StatsModule } from '../stats/stats.module';
import { UsersModule } from '../users/users.module';
import { ClausesModule } from '../clauses/clauses.module';
import { ScalesModule } from '../scales/scales.module';
import { ViolationsModule } from '../violations/violations.module';
import { PenaltyEngineModule } from '../penalty-engine/penalty-engine.module';
import { APP_FILTER } from '@nestjs/core';
import { BotGlobalExceptionFilter } from './filters/telegraf-exception.filter';

@Module({
  imports: [
    PrismaModule,
    RopsModule,
    ManagersModule,
    StatsModule,
    UsersModule,
    ClausesModule,
    ScalesModule,
    ViolationsModule,
    PenaltyEngineModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule, PrismaModule],
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService) => {
        const token = config.get<string>('BOT_TOKEN') || 'DUMMY_TOKEN';
        const isTest = config.get<string>('NODE_ENV') === 'test' || process.env.NODE_ENV === 'test';
        const useWebhook = config.get<string>('USE_WEBHOOK') === 'true';
        const webhookUrl = config.get<string>('WEBHOOK_URL');

        let launchOptions: any = undefined;
        if (isTest) {
          launchOptions = false;
        } else if (useWebhook && webhookUrl) {
          launchOptions = {
            webhook: {
              domain: webhookUrl,
              hookPath: '/telegram/webhook',
            },
          };
        }

        return {
          token,
          launchOptions,
          middlewares: [
            createPrismaSessionMiddleware(prisma),
            createAuthMiddleware(prisma, config),
          ],
        };
      },
    }),
  ],
  providers: [
    TelegramUpdate,
    ViolationWizard,
    {
      provide: APP_FILTER,
      useClass: BotGlobalExceptionFilter,
    },
  ],
})
export class TelegramBotModule {}
