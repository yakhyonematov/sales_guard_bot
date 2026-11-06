import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  getMonthKey,
  getMonthRange,
  formatDateUz,
  formatMoneyUz,
  formatConsequenceUz,
} from '../common/utils/date-time.util';
import { TierType } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { DateTime } from 'luxon';

export interface ManagerMonthlyStats {
  managerId: string;
  managerName: string;
  ropName: string;
  monthKey: string;
  totalViolations: number;
  totalAmount: number;
  totalFacts: number;
  clauseBreakdown: Array<{
    clauseCode: string;
    count: number;
    amount: number;
    facts: number;
  }>;
}

export interface RopMonthlyStats {
  ropId: string;
  ropName: string;
  monthKey: string;
  totalViolations: number;
  totalAmount: number;
  totalFacts: number;
  managerRankings: Array<{
    managerId: string;
    managerName: string;
    count: number;
    amount: number;
    facts: number;
  }>;
  topClauses: Array<{
    clauseCode: string;
    count: number;
  }>;
}

export interface GlobalMonthlyStats {
  monthKey: string;
  totalViolations: number;
  totalAmount: number;
  totalFacts: number;
  teamStats: Array<{
    ropName: string;
    totalAmount: number;
    totalViolations: number;
    totalFacts: number;
  }>;
  topClauses: Array<{
    clauseCode: string;
    clauseText: string;
    count: number;
  }>;
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates month list options for the month selector (current month + past 5 months)
   */
  getAvailableMonths(): Array<{ key: string; label: string }> {
    const months: Array<{ key: string; label: string }> = [];
    const now = DateTime.now().setZone('Asia/Tashkent');

    for (let i = 0; i < 6; i++) {
      const dt = now.minus({ months: i });
      const key = dt.toFormat('yyyy-MM');
      const label = dt.toFormat('LLLL yyyy'); // e.g. "Noyabr 2026"
      months.push({ key, label });
    }
    return months;
  }

  /**
   * Stats for a single manager in a given month
   */
  async getManagerStats(managerId: string, monthKey = getMonthKey()): Promise<ManagerMonthlyStats | null> {
    const manager = await this.prisma.manager.findUnique({
      where: { id: managerId },
      include: { rop: { include: { user: true } } },
    });
    if (!manager) return null;

    const violations = await this.prisma.violation.findMany({
      where: {
        managerId,
        monthKey,
        revokedAt: null,
      },
      include: { clause: true },
      orderBy: { occurredAt: 'asc' },
    });

    let totalAmount = 0;
    let totalFacts = 0;
    const clauseMap = new Map<string, { count: number; amount: number; facts: number }>();

    for (const v of violations) {
      if (v.resultType === TierType.FACT) {
        totalFacts++;
      } else {
        totalAmount += v.resultAmount;
      }

      const existing = clauseMap.get(v.clause.code) || { count: 0, amount: 0, facts: 0 };
      existing.count++;
      if (v.resultType === TierType.FACT) {
        existing.facts++;
      } else {
        existing.amount += v.resultAmount;
      }
      clauseMap.set(v.clause.code, existing);
    }

    const clauseBreakdown = Array.from(clauseMap.entries())
      .map(([clauseCode, data]) => ({
        clauseCode,
        count: data.count,
        amount: data.amount,
        facts: data.facts,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      managerId: manager.id,
      managerName: manager.fullName,
      ropName: manager.rop.user.fullName,
      monthKey,
      totalViolations: violations.length,
      totalAmount,
      totalFacts,
      clauseBreakdown,
    };
  }

  /**
   * Stats for an entire ROP team in a given month
   */
  async getRopStats(ropId: string, monthKey = getMonthKey()): Promise<RopMonthlyStats | null> {
    const rop = await this.prisma.rop.findUnique({
      where: { id: ropId },
      include: {
        user: true,
        managers: {
          where: { isActive: true },
        },
      },
    });
    if (!rop) return null;

    const violations = await this.prisma.violation.findMany({
      where: {
        manager: { ropId },
        monthKey,
        revokedAt: null,
      },
      include: { manager: true, clause: true },
    });

    let totalAmount = 0;
    let totalFacts = 0;
    const managerMap = new Map<string, { managerName: string; count: number; amount: number; facts: number }>();
    const clauseMap = new Map<string, number>();

    // Initialize all active managers with 0
    for (const m of rop.managers) {
      managerMap.set(m.id, { managerName: m.fullName, count: 0, amount: 0, facts: 0 });
    }

    for (const v of violations) {
      if (v.resultType === TierType.FACT) {
        totalFacts++;
      } else {
        totalAmount += v.resultAmount;
      }

      const mData = managerMap.get(v.managerId) || {
        managerName: v.manager.fullName,
        count: 0,
        amount: 0,
        facts: 0,
      };
      mData.count++;
      if (v.resultType === TierType.FACT) {
        mData.facts++;
      } else {
        mData.amount += v.resultAmount;
      }
      managerMap.set(v.managerId, mData);

      clauseMap.set(v.clause.code, (clauseMap.get(v.clause.code) || 0) + 1);
    }

    const managerRankings = Array.from(managerMap.entries())
      .map(([id, d]) => ({
        managerId: id,
        managerName: d.managerName,
        count: d.count,
        amount: d.amount,
        facts: d.facts,
      }))
      .sort((a, b) => b.amount - a.amount || b.facts - a.facts || b.count - a.count);

    const topClauses = Array.from(clauseMap.entries())
      .map(([code, count]) => ({ clauseCode: code, count }))
      .sort((a, b) => b.count - a.count);

    return {
      ropId: rop.id,
      ropName: rop.user.fullName,
      monthKey,
      totalViolations: violations.length,
      totalAmount,
      totalFacts,
      managerRankings,
      topClauses,
    };
  }

  /**
   * Global overview stats across all teams
   */
  async getGlobalStats(monthKey = getMonthKey()): Promise<GlobalMonthlyStats> {
    const [violations, rops] = await Promise.all([
      this.prisma.violation.findMany({
        where: {
          monthKey,
          revokedAt: null,
        },
        include: {
          manager: { include: { rop: { include: { user: true } } } },
          clause: true,
        },
      }),
      this.prisma.rop.findMany({
        where: { isActive: true },
        include: { user: true },
      }),
    ]);

    let totalAmount = 0;
    let totalFacts = 0;
    const teamMap = new Map<string, { ropName: string; totalAmount: number; totalViolations: number; totalFacts: number }>();
    const clauseMap = new Map<string, { text: string; count: number }>();

    for (const r of rops) {
      teamMap.set(r.id, {
        ropName: r.user.fullName,
        totalAmount: 0,
        totalViolations: 0,
        totalFacts: 0,
      });
    }

    for (const v of violations) {
      if (v.resultType === TierType.FACT) {
        totalFacts++;
      } else {
        totalAmount += v.resultAmount;
      }

      const team = teamMap.get(v.manager.ropId);
      if (team) {
        team.totalViolations++;
        if (v.resultType === TierType.FACT) {
          team.totalFacts++;
        } else {
          team.totalAmount += v.resultAmount;
        }
      }

      const cl = clauseMap.get(v.clause.code) || { text: v.clause.text, count: 0 };
      cl.count++;
      clauseMap.set(v.clause.code, cl);
    }

    const teamStats = Array.from(teamMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);
    const topClauses = Array.from(clauseMap.entries())
      .map(([code, d]) => ({ clauseCode: code, clauseText: d.text, count: d.count }))
      .sort((a, b) => b.count - a.count);

    return {
      monthKey,
      totalViolations: violations.length,
      totalAmount,
      totalFacts,
      teamStats,
      topClauses,
    };
  }

  /**
   * Generates a multi-sheet Excel (.xlsx) file
   */
  async generateExcelReport(params: { monthKey: string; ropId?: string }): Promise<Buffer> {
    const { monthKey, ropId } = params;

    const whereClause: any = {
      monthKey,
      revokedAt: null,
    };
    if (ropId) {
      whereClause.manager = { ropId };
    }

    const violations = await this.prisma.violation.findMany({
      where: whereClause,
      include: {
        manager: { include: { rop: { include: { user: true } } } },
        clause: true,
        createdBy: true,
      },
      orderBy: { occurredAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OKK Bot';
    workbook.created = new Date();

    // 1. Summary Sheet
    const summarySheet = workbook.addWorksheet('Umumiy (Summary)');
    summarySheet.columns = [
      { header: "Ko'rsatkich", key: 'indicator', width: 30 },
      { header: 'Qiymat', key: 'value', width: 30 },
    ];

    let totalAmount = 0;
    let totalFacts = 0;
    violations.forEach((v) => {
      if (v.resultType === TierType.FACT) totalFacts++;
      else totalAmount += v.resultAmount;
    });

    summarySheet.addRow({ indicator: 'Hisobot oyi', value: monthKey });
    summarySheet.addRow({ indicator: 'Jami jarimalar soni', value: violations.length });
    summarySheet.addRow({ indicator: 'Jami jarima summasi (UZS)', value: totalAmount });
    summarySheet.addRow({ indicator: 'Jami olingan faktlar', value: totalFacts });

    // 2. By Manager Sheet
    const managerSheet = workbook.addWorksheet('Menejerlar kesimida');
    managerSheet.columns = [
      { header: 'Menejer', key: 'manager', width: 28 },
      { header: 'ROP / Jamoa', key: 'rop', width: 25 },
      { header: 'Qoidabuzarliklar soni', key: 'count', width: 22 },
      { header: 'Summa (UZS)', key: 'amount', width: 20 },
      { header: 'Faktlar soni', key: 'facts', width: 15 },
    ];

    const mgrMap = new Map<string, { name: string; rop: string; count: number; amount: number; facts: number }>();
    for (const v of violations) {
      const entry = mgrMap.get(v.managerId) || {
        name: v.manager.fullName,
        rop: v.manager.rop.user.fullName,
        count: 0,
        amount: 0,
        facts: 0,
      };
      entry.count++;
      if (v.resultType === TierType.FACT) entry.facts++;
      else entry.amount += v.resultAmount;
      mgrMap.set(v.managerId, entry);
    }

    Array.from(mgrMap.values())
      .sort((a, b) => b.amount - a.amount)
      .forEach((m) => {
        managerSheet.addRow({
          manager: m.name,
          rop: m.rop,
          count: m.count,
          amount: m.amount,
          facts: m.facts,
        });
      });

    // 3. By Clause Sheet
    const clauseSheet = workbook.addWorksheet('Bandlar kesimida');
    clauseSheet.columns = [
      { header: 'Band raqami', key: 'code', width: 15 },
      { header: 'Qoida matni', key: 'text', width: 50 },
      { header: 'Buzilishlar soni', key: 'count', width: 20 },
    ];

    const clMap = new Map<string, { text: string; count: number }>();
    for (const v of violations) {
      const entry = clMap.get(v.clause.code) || { text: v.clause.text, count: 0 };
      entry.count++;
      clMap.set(v.clause.code, entry);
    }

    Array.from(clMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .forEach(([code, d]) => {
        clauseSheet.addRow({
          code,
          text: d.text,
          count: d.count,
        });
      });

    // 4. Violations Log Sheet
    const logSheet = workbook.addWorksheet('Jarimalar jurnali');
    logSheet.columns = [
      { header: 'Vaqt (Asia/Tashkent)', key: 'time', width: 22 },
      { header: 'Menejer', key: 'manager', width: 25 },
      { header: 'ROP', key: 'rop', width: 22 },
      { header: 'Band', key: 'clause', width: 12 },
      { header: 'Takrorlanish', key: 'occurrence', width: 15 },
      { header: 'Natija turi', key: 'type', width: 14 },
      { header: 'Summa (UZS)', key: 'amount', width: 16 },
      { header: 'Izoh', key: 'comment', width: 35 },
      { header: 'Kirituvchi xodim', key: 'staff', width: 22 },
    ];

    violations.forEach((v) => {
      logSheet.addRow({
        time: formatDateUz(v.occurredAt),
        manager: v.manager.fullName,
        rop: v.manager.rop.user.fullName,
        clause: v.clause.code,
        occurrence: `${v.occurrenceIndex}-marta`,
        type: v.resultType === TierType.FACT ? 'FAKT' : 'SUMMA',
        amount: v.resultAmount,
        comment: v.comment || '',
        staff: v.createdBy.fullName,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
