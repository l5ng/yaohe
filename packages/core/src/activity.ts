import type { ActivityEstimate, UserPrompt } from './model.js'
import { parseTimestamp } from './time.js'

/** Activity estimation: group by provider/session and split work segments on gaps longer than 30 minutes. */
export function estimateActivity(prompts: UserPrompt[]): ActivityEstimate {
  const groups = new Map<string, number[]>()
  for (const prompt of prompts) {
    const instant = parseTimestamp(prompt.timestamp)
    if (!instant) continue
    const key = `${prompt.provider}\0${prompt.session_id}`
    const timestamps = groups.get(key) ?? []
    timestamps.push(instant.epochMilliseconds / 1000)
    groups.set(key, timestamps)
  }

  let totalSeconds = 0
  let segments = 0
  for (const timestamps of groups.values()) {
    timestamps.sort((a, b) => a - b)
    if (timestamps.length === 0) continue
    segments += 1
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1]
      if (gap > 30 * 60) {
        segments += 1
      } else if (gap > 0) {
        totalSeconds += gap
      }
    }
  }

  return {
    estimated_minutes: Math.ceil(totalSeconds / 60),
    has_duration_evidence: totalSeconds > 0,
    segments,
    prompt_events: prompts.length,
    is_estimate: true,
    method: 'Grouped by provider/session; gaps longer than 30 minutes split work segments; a single prompt is not counted',
  }
}
