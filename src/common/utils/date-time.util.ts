import { DateTime } from 'luxon';

export const DEFAULT_TIMEZONE = 'Asia/Tashkent';

export function getNowInTashkent(tz = DEFAULT_TIMEZONE): DateTime {
  return DateTime.now().setZone(tz);
}

export function getMonthKey(date: Date = new Date(), tz = DEFAULT_TIMEZONE): string {
  return DateTime.fromJSDate(date).setZone(tz).toFormat('yyyy-MM');
}

export function getMonthRange(monthKey: string, tz = DEFAULT_TIMEZONE): { start: Date; end: Date } {
  const dt = DateTime.fromFormat(monthKey, 'yyyy-MM', { zone: tz });
  const start = dt.startOf('month').toJSDate();
  const end = dt.endOf('month').toJSDate();
  return { start, end };
}

export function formatDateUz(date: Date, tz = DEFAULT_TIMEZONE): string {
  return DateTime.fromJSDate(date).setZone(tz).toFormat('dd.MM.yyyy HH:mm');
}

export function formatDateShortUz(date: Date, tz = DEFAULT_TIMEZONE): string {
  return DateTime.fromJSDate(date).setZone(tz).toFormat('dd.MM.yyyy');
}

export function formatMoneyUz(amount: number): string {
  const formatted = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} so'm`;
}

export function formatConsequenceUz(type: 'AMOUNT' | 'FACT', amount: number): string {
  if (type === 'FACT') {
    return 'Fakt olindi';
  }
  return formatMoneyUz(amount);
}
