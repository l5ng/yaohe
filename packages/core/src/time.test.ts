import { expect, test } from 'vitest'
import { formatTimeInZone, parseTimestamp, resolveWindow, windowContains } from './time.js'

test('shanghai window uses natural day and excludes next midnight', () => {
  const window = resolveWindow('2026-07-22', 'Asia/Shanghai')
  expect(window.timezone).toBe('Asia/Shanghai')
  // 2026-07-22 00:00 +08:00 = 2026-07-21 16:00:00Z
  expect(window.start.toJSON()).toBe('2026-07-21T16:00:00Z')
  expect(window.end.toJSON()).toBe('2026-07-22T16:00:00Z')
  expect(windowContains(window, window.start)).toBe(true)
  expect(windowContains(window, window.end)).toBe(false)
})

test('rejects invalid date and timezone', () => {
  expect(() => resolveWindow('2026/07/22', 'Asia/Shanghai')).toThrow(/Invalid date format/)
  expect(() => resolveWindow('2026-07-22', 'Mars/Olympus')).toThrow(/Unsupported timezone/)
})

test('parses rfc3339, offset and millisecond timestamps', () => {
  const rfc3339 = parseTimestamp('2026-07-22T00:00:00Z')
  expect(rfc3339?.toJSON()).toBe('2026-07-22T00:00:00Z')

  const offset = parseTimestamp('2026-07-22 01:00:00+08:00')
  expect(offset?.toJSON()).toBe('2026-07-21T17:00:00Z')

  const millis = parseTimestamp(1_774_224_000_000)
  expect(millis?.epochMilliseconds).toBe(1_774_224_000_000)

  const seconds = parseTimestamp(1_774_224_000)
  expect(seconds?.epochMilliseconds).toBe(1_774_224_000_000)

  expect(parseTimestamp('not-a-time')).toBeNull()
  expect(parseTimestamp(null)).toBeNull()
})

test('formats times in an IANA zone and offset label', () => {
  const nineUtc = new Date('2026-07-22T09:00:00Z').getTime()
  expect(formatTimeInZone(nineUtc, 'Asia/Shanghai')).toBe('17:00')
  expect(formatTimeInZone(nineUtc, '+08:00')).toBe('17:00')
  expect(formatTimeInZone(nineUtc, '-05:00')).toBe('04:00')
  expect(formatTimeInZone(0, '+08:00')).toBe('08:00')
})

test('falls back to UTC for an invalid timezone', () => {
  expect(formatTimeInZone(new Date('2026-07-22T09:00:00Z').getTime(), 'Mars/Olympus')).toBe('09:00')
})

test('local offset label agrees with formatTimeInZone at the current instant', () => {
  const window = resolveWindow()
  const now = Date.now()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(now))
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00'
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  expect(formatTimeInZone(now, window.timezone)).toBe(`${hour}:${minute}`)
})
