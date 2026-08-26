/** A point in time; wraps epoch milliseconds with an ISO string view. */
export class Instant {
  readonly epochMilliseconds: number

  constructor(epochMilliseconds: number) {
    this.epochMilliseconds = epochMilliseconds
  }

  toJSON(): string {
    const iso = new Date(this.epochMilliseconds).toISOString()
    // Drop the millisecond part when zero to match RFC3339 second precision.
    return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso
  }
}

export interface ReportWindow {
  /** YYYY-MM-DD */
  date: string
  /** IANA timezone name, or the offset label such as +08:00 when local */
  timezone: string
  start: Instant
  end: Instant
}

export function resolveWindow(dateArg?: string, timezoneArg?: string): ReportWindow {
  const timezone = timezoneArg ?? 'local'
  const isLocal = timezone.toLowerCase() === 'local'
  const zone = isLocal ? localTimeZone() : timezone
  if (!isLocal) validateTimezone(zone)

  const now = Date.now()
  const date = dateArg !== undefined ? parseDate(dateArg) : calendarParts(zone, now)

  const start = toMidnightInstant(date, zone)
  const end = toMidnightInstant(addDays(date), zone)
  if (end.epochMilliseconds <= start.epochMilliseconds) throw new Error('Invalid report time window')

  return {
    date: formatDate(date),
    timezone: isLocal ? localOffsetLabel(now) : timezone,
    start,
    end,
  }
}

function validateTimezone(zone: string): void {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    throw new Error(`Unsupported timezone: ${zone}`)
  }
}

interface CalendarDate {
  year: number
  month: number
  day: number
}

function parseDate(text: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw new Error(`Invalid date format: ${text}; expected YYYY-MM-DD`)
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  const roundTrip = new Date(Date.UTC(date.year, date.month - 1, date.day))
  if (
    roundTrip.getUTCFullYear() !== date.year
    || roundTrip.getUTCMonth() !== date.month - 1
    || roundTrip.getUTCDate() !== date.day
  ) {
    throw new Error(`Invalid date format: ${text}; expected YYYY-MM-DD`)
  }
  return date
}

function addDays(date: CalendarDate): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1))
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }
}

function formatDate(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

function calendarParts(zone: string, epochMs: number): CalendarDate {
  const { year, month, day } = timeParts(zone, epochMs)
  return { year, month, day }
}

function toMidnightInstant(date: CalendarDate, zone: string): Instant {
  const utcMidnight = Date.UTC(date.year, date.month - 1, date.day)
  // ponytail: one-pass offset lookup at UTC midnight; converges for every real-world
  // zone, revisit if a zone ever transitions exactly at midnight.
  return new Instant(utcMidnight - tzOffsetMs(zone, utcMidnight))
}

function timeParts(zone: string, epochMs: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epochMs))
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

function tzOffsetMs(zone: string, epochMs: number): number {
  const { year, month, day, hour, minute, second } = timeParts(zone, epochMs)
  return (
    Date.UTC(year, month - 1, day, hour, minute, second) - epochMs
  )
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}

function localOffsetLabel(epochMs: number): string {
  const offset = tzOffsetMs(localTimeZone(), epochMs)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  const hours = String(Math.floor(abs / 3_600_000)).padStart(2, '0')
  const minutes = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

export function parseTimestamp(value: unknown): Instant | null {
  if (typeof value === 'string') {
    const text = value.trim().replace(' ', 'T')
    const ms = Date.parse(text)
    if (Number.isFinite(ms)) return new Instant(ms)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Instant(value > 10_000_000_000 ? value : value * 1000)
  }
  return null
}

export function windowContains(window: ReportWindow, timestamp: Instant): boolean {
  return timestamp.epochMilliseconds >= window.start.epochMilliseconds
    && timestamp.epochMilliseconds < window.end.epochMilliseconds
}
