import { Test, TestingModule } from '@nestjs/testing';
import { PenaltyEngineService, ScaleTierItem } from './penalty-engine.service';
import { TierType } from '@prisma/client';
import { getMonthKey, getMonthRange } from '../common/utils/date-time.util';

describe('PenaltyEngineService', () => {
  let service: PenaltyEngineService;

  const scaleATiers: ScaleTierItem[] = [
    { occurrence: 1, type: TierType.AMOUNT, amount: 60000 },
    { occurrence: 2, type: TierType.AMOUNT, amount: 60000 },
    { occurrence: 3, type: TierType.AMOUNT, amount: 100000 },
    { occurrence: 4, type: TierType.AMOUNT, amount: 0 },
    { occurrence: 5, type: TierType.FACT, amount: 0 },
  ];

  const scaleBTiers: ScaleTierItem[] = [
    { occurrence: 1, type: TierType.AMOUNT, amount: 100000 },
    { occurrence: 2, type: TierType.AMOUNT, amount: 100000 },
    { occurrence: 3, type: TierType.AMOUNT, amount: 0 },
    { occurrence: 4, type: TierType.FACT, amount: 0 },
    { occurrence: 5, type: TierType.FACT, amount: 0 },
  ];

  const scaleCTiers: ScaleTierItem[] = [
    { occurrence: 1, type: TierType.AMOUNT, amount: 0 },
    { occurrence: 2, type: TierType.AMOUNT, amount: 0 },
    { occurrence: 3, type: TierType.FACT, amount: 0 },
    { occurrence: 4, type: TierType.FACT, amount: 0 },
    { occurrence: 5, type: TierType.FACT, amount: 0 },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PenaltyEngineService],
    }).compile();

    service = module.get<PenaltyEngineService>(PenaltyEngineService);
  });

  describe('Scale A Calculations', () => {
    it('occurrence 1 -> 60 000 UZS', () => {
      const res = service.calculateConsequence(scaleATiers, 1);
      expect(res.occurrenceIndex).toBe(1);
      expect(res.type).toBe(TierType.AMOUNT);
      expect(res.amount).toBe(60000);
      expect(res.formattedResult).toBe("60 000 so'm");
    });

    it('occurrence 2 -> 60 000 UZS', () => {
      const res = service.calculateConsequence(scaleATiers, 2);
      expect(res.occurrenceIndex).toBe(2);
      expect(res.type).toBe(TierType.AMOUNT);
      expect(res.amount).toBe(60000);
      expect(res.formattedResult).toBe("60 000 so'm");
    });

    it('occurrence 3 -> 100 000 UZS', () => {
      const res = service.calculateConsequence(scaleATiers, 3);
      expect(res.occurrenceIndex).toBe(3);
      expect(res.type).toBe(TierType.AMOUNT);
      expect(res.amount).toBe(100000);
      expect(res.formattedResult).toBe("100 000 so'm");
    });

    it('occurrence 4 -> 0 UZS', () => {
      const res = service.calculateConsequence(scaleATiers, 4);
      expect(res.occurrenceIndex).toBe(4);
      expect(res.type).toBe(TierType.AMOUNT);
      expect(res.amount).toBe(0);
      expect(res.formattedResult).toBe("0 so'm");
    });

    it('occurrence 5 -> FACT', () => {
      const res = service.calculateConsequence(scaleATiers, 5);
      expect(res.occurrenceIndex).toBe(5);
      expect(res.type).toBe(TierType.FACT);
      expect(res.amount).toBe(0);
      expect(res.formattedResult).toBe('Fakt olindi');
    });

    it('occurrence 6 (5+ rule) -> FACT', () => {
      const res = service.calculateConsequence(scaleATiers, 6);
      expect(res.occurrenceIndex).toBe(6);
      expect(res.type).toBe(TierType.FACT);
      expect(res.formattedResult).toBe('Fakt olindi');
    });

    it('occurrence 10 (5+ rule) -> FACT', () => {
      const res = service.calculateConsequence(scaleATiers, 10);
      expect(res.occurrenceIndex).toBe(10);
      expect(res.type).toBe(TierType.FACT);
      expect(res.formattedResult).toBe('Fakt olindi');
    });
  });

  describe('Scale B Calculations', () => {
    it('occurrence 1 -> 100 000 UZS', () => {
      const res = service.calculateConsequence(scaleBTiers, 1);
      expect(res.type).toBe(TierType.AMOUNT);
      expect(res.amount).toBe(100000);
    });

    it('occurrence 2 -> 100 000 UZS', () => {
      const res = service.calculateConsequence(scaleBTiers, 2);
      expect(res.type).toBe(TierType.AMOUNT);
      expect(res.amount).toBe(100000);
    });

    it('occurrence 3 -> 0 UZS', () => {
      const res = service.calculateConsequence(scaleBTiers, 3);
      expect(res.type).toBe(TierType.AMOUNT);
      expect(res.amount).toBe(0);
    });

    it('occurrence 4 -> FACT', () => {
      const res = service.calculateConsequence(scaleBTiers, 4);
      expect(res.type).toBe(TierType.FACT);
    });

    it('occurrence 5+ -> FACT', () => {
      const res = service.calculateConsequence(scaleBTiers, 5);
      expect(res.type).toBe(TierType.FACT);

      const res7 = service.calculateConsequence(scaleBTiers, 7);
      expect(res7.type).toBe(TierType.FACT);
    });
  });

  describe('Scale C Calculations', () => {
    it('occurrence 1 -> 0 UZS', () => {
      const res = service.calculateConsequence(scaleCTiers, 1);
      expect(res.type).toBe(TierType.AMOUNT);
      expect(res.amount).toBe(0);
    });

    it('occurrence 2 -> 0 UZS', () => {
      const res = service.calculateConsequence(scaleCTiers, 2);
      expect(res.type).toBe(TierType.AMOUNT);
      expect(res.amount).toBe(0);
    });

    it('occurrence 3 -> FACT', () => {
      const res = service.calculateConsequence(scaleCTiers, 3);
      expect(res.type).toBe(TierType.FACT);
    });

    it('occurrence 5+ -> FACT', () => {
      const res = service.calculateConsequence(scaleCTiers, 5);
      expect(res.type).toBe(TierType.FACT);
    });
  });

  describe('Upcoming Warning Preview', () => {
    it('warns correctly for next occurrence escalation', () => {
      // Scale A: current count 2 -> next is 3 (100 000 UZS)
      const warn = service.calculateUpcomingWarning(scaleATiers, 2);
      expect(warn).toBe("100 000 so'm");

      // Scale A: current count 4 -> next is 5 (FACT)
      const warnFact = service.calculateUpcomingWarning(scaleATiers, 4);
      expect(warnFact).toBe('Fakt olinadi');
    });
  });

  describe('Recompute Chain on Revoke / Restore', () => {
    it('recomputes indices and amounts when one item is removed from middle', () => {
      const t1 = new Date('2026-11-01T10:00:00Z');
      const t2 = new Date('2026-11-02T10:00:00Z');
      const t3 = new Date('2026-11-03T10:00:00Z');

      // Imagine v2 was revoked, remaining active violations are v1 and v3:
      const remainingViolations = [
        {
          id: 'v1',
          occurredAt: t1,
          occurrenceIndex: 1,
          resultType: TierType.AMOUNT,
          resultAmount: 60000,
        },
        {
          id: 'v3',
          occurredAt: t3,
          occurrenceIndex: 3, // previously was 3rd (100k)
          resultType: TierType.AMOUNT,
          resultAmount: 100000,
        },
      ];

      const recomputed = service.recomputeChain(remainingViolations, scaleATiers);

      // v1 remains index 1, 60000, not changed
      expect(recomputed[0].id).toBe('v1');
      expect(recomputed[0].occurrenceIndex).toBe(1);
      expect(recomputed[0].resultAmount).toBe(60000);
      expect(recomputed[0].changed).toBe(false);

      // v3 becomes index 2, 60000 (downgraded from 100k to 60k!), changed: true
      expect(recomputed[1].id).toBe('v3');
      expect(recomputed[1].occurrenceIndex).toBe(2);
      expect(recomputed[1].resultAmount).toBe(60000);
      expect(recomputed[1].changed).toBe(true);
      expect(recomputed[1].oldOccurrenceIndex).toBe(3);
      expect(recomputed[1].oldResultAmount).toBe(100000);
    });
  });

  describe('Timezone & Month Boundaries', () => {
    it('computes month key correctly in Asia/Tashkent (UTC+5)', () => {
      // 2026-10-31 20:00:00 UTC = 2026-11-01 01:00:00 Tashkent (+5h)
      const novDate = new Date('2026-10-31T20:00:00Z');
      expect(getMonthKey(novDate)).toBe('2026-11');

      // 2026-10-31 18:00:00 UTC = 2026-10-31 23:00:00 Tashkent
      const octDate = new Date('2026-10-31T18:00:00Z');
      expect(getMonthKey(octDate)).toBe('2026-10');
    });

    it('provides correct start and end range for month query', () => {
      const range = getMonthRange('2026-11');
      expect(range.start).toBeDefined();
      expect(range.end).toBeDefined();
      expect(range.start.getTime()).toBeLessThan(range.end.getTime());
    });
  });
});
