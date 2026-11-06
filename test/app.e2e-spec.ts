import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './../src/app.module';
import { PenaltyEngineService } from '../src/penalty-engine/penalty-engine.service';
import { ViolationsService } from '../src/violations/violations.service';
import { StatsService } from '../src/stats/stats.service';
import { getBotToken } from 'nestjs-telegraf';

describe('AppModule Bootstrap & Services (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      try {
        const bot = app.get(getBotToken());
        if (bot) {
          bot.stop = () => {};
        }
      } catch (e) {}
      await app.close();
    }
  });

  it('PenaltyEngineService is injected and functional', () => {
    const penaltyEngine = app.get(PenaltyEngineService);
    expect(penaltyEngine).toBeDefined();
  });

  it('ViolationsService is injected and functional', () => {
    const violationsService = app.get(ViolationsService);
    expect(violationsService).toBeDefined();
  });

  it('StatsService is injected and functional', () => {
    const statsService = app.get(StatsService);
    expect(statsService).toBeDefined();
    const months = statsService.getAvailableMonths();
    expect(months.length).toBeGreaterThan(0);
  });
});
