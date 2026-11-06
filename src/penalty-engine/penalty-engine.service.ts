import { Injectable, Logger } from '@nestjs/common';
import { TierType } from '@prisma/client';
import { formatConsequenceUz } from '../common/utils/date-time.util';

export interface ScaleTierItem {
  occurrence: number;
  type: TierType;
  amount: number;
}

export interface CalculationResult {
  occurrenceIndex: number;
  type: TierType;
  amount: number;
  formattedResult: string;
}

export interface RecomputedViolationResult {
  id: string;
  occurrenceIndex: number;
  resultType: TierType;
  resultAmount: number;
  changed: boolean;
  oldOccurrenceIndex: number;
  oldResultType: TierType;
  oldResultAmount: number;
}

@Injectable()
export class PenaltyEngineService {
  private readonly logger = new Logger(PenaltyEngineService.name);

  /**
   * Pure calculation: given a list of tiers for a scale and an occurrence index (1-based),
   * returns the consequence (type, amount, formatted label).
   */
  calculateConsequence(tiers: ScaleTierItem[], occurrenceIndex: number): CalculationResult {
    if (!tiers || tiers.length === 0) {
      this.logger.warn(`No tiers defined for scale calculation at occurrence ${occurrenceIndex}`);
      return {
        occurrenceIndex,
        type: TierType.AMOUNT,
        amount: 0,
        formattedResult: formatConsequenceUz(TierType.AMOUNT, 0),
      };
    }

    const sortedTiers = [...tiers].sort((a, b) => a.occurrence - b.occurrence);
    const maxTier = sortedTiers[sortedTiers.length - 1];

    let matchedTier = sortedTiers.find((t) => t.occurrence === occurrenceIndex);

    // If occurrenceIndex exceeds highest defined tier (e.g. 5+ rule), fall back to highest tier
    if (!matchedTier) {
      if (occurrenceIndex >= maxTier.occurrence) {
        matchedTier = maxTier;
      } else {
        // Fallback to highest tier defined if scale is sparse
        matchedTier = maxTier;
      }
    }

    return {
      occurrenceIndex,
      type: matchedTier.type,
      amount: matchedTier.type === TierType.FACT ? 0 : matchedTier.amount,
      formattedResult: formatConsequenceUz(matchedTier.type, matchedTier.amount),
    };
  }

  /**
   * Calculate consequence for next violation given current active violation count in the month
   */
  calculateNextOccurrence(tiers: ScaleTierItem[], currentCount: number): CalculationResult {
    return this.calculateConsequence(tiers, currentCount + 1);
  }

  /**
   * Generates a warning preview for what happens if manager commits the violation again
   */
  calculateUpcomingWarning(tiers: ScaleTierItem[], currentCount: number): string {
    const nextResult = this.calculateNextOccurrence(tiers, currentCount);
    if (nextResult.type === TierType.FACT) {
      return "Fakt olinadi";
    }
    return formatConsequenceUz(nextResult.type, nextResult.amount);
  }

  /**
   * Recomputes an ordered chain of active violations (sorted by occurredAt ascending).
   * Used when a violation in the sequence is revoked or restored.
   */
  recomputeChain(
    violations: Array<{
      id: string;
      occurredAt: Date;
      occurrenceIndex: number;
      resultType: TierType;
      resultAmount: number;
    }>,
    tiers: ScaleTierItem[],
  ): RecomputedViolationResult[] {
    const sorted = [...violations].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );

    return sorted.map((v, idx) => {
      const newOccurrenceIndex = idx + 1;
      const calc = this.calculateConsequence(tiers, newOccurrenceIndex);

      const changed =
        v.occurrenceIndex !== newOccurrenceIndex ||
        v.resultType !== calc.type ||
        v.resultAmount !== calc.amount;

      return {
        id: v.id,
        occurrenceIndex: newOccurrenceIndex,
        resultType: calc.type,
        resultAmount: calc.amount,
        changed,
        oldOccurrenceIndex: v.occurrenceIndex,
        oldResultType: v.resultType,
        oldResultAmount: v.resultAmount,
      };
    });
  }
}
