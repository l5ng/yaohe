import type { ReportContext, UserPrompt } from './model.js'

export interface ContextBudgets {
  total_chars: number
  prompt_chars: number
  readme_chars: number
  max_prompts: number
}

export const DEFAULT_BUDGETS: ContextBudgets = {
  total_chars: 120_000,
  prompt_chars: 60_000,
  readme_chars: 12_000,
  max_prompts: 200,
}

export const PER_PROMPT_LIMIT = 8_000

export function truncateChars(text: string, limit: number): [string, boolean] {
  const chars = Array.from(text)
  if (chars.length <= limit) return [text, false]
  return [chars.slice(0, limit).join('') + '…', true]
}

function promptLength(prompt: UserPrompt): number {
  return Array.from(prompt.text).length
}

function sessionKey(prompt: UserPrompt): string {
  return `${prompt.provider}\0${prompt.session_id}`
}

function normalizePromptText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Budget algorithm: truncate each prompt, drop near-duplicate messages within a
 * session, keep each session's first prompt plus the newest records, then drop
 * the README before older prompts when over the total budget.
 */
export function applyBudgets(context: ReportContext, budgets: ContextBudgets): void {
  const perPromptLimit = Math.min(PER_PROMPT_LIMIT, budgets.prompt_chars)
  for (const prompt of context.prompts) {
    const [text, truncated] = truncateChars(prompt.text, perPromptLimit)
    if (truncated) {
      prompt.text = text
      context.truncation.prompt_texts_truncated += 1
    }
  }
  if (context.truncation.prompt_texts_truncated > 0) {
    context.warnings.push(
      `${context.truncation.prompt_texts_truncated} user prompt(s) were too long and truncated individually`,
    )
  }

  const seenBySession = new Map<string, Set<string>>()
  const deduped: UserPrompt[] = []
  let duplicates = 0
  for (const prompt of context.prompts) {
    const seen = seenBySession.get(sessionKey(prompt)) ?? new Set<string>()
    const normalized = normalizePromptText(prompt.text)
    if (seen.has(normalized)) {
      duplicates += 1
      continue
    }
    seen.add(normalized)
    seenBySession.set(sessionKey(prompt), seen)
    deduped.push(prompt)
  }
  if (duplicates > 0) {
    context.truncation.prompts_dropped += duplicates
    context.warnings.push(
      `Removed ${duplicates} duplicate user prompt(s) with identical text within the same session`,
    )
  }
  context.prompts = deduped

  const firstBySession = new Map<string, UserPrompt>()
  for (const prompt of context.prompts) {
    if (!firstBySession.has(sessionKey(prompt))) firstBySession.set(sessionKey(prompt), prompt)
  }

  const kept: UserPrompt[] = []
  const keptSet = new Set<UserPrompt>()
  let usedChars = 0
  let droppedByBudget = 0
  const canKeep = (prompt: UserPrompt): boolean => {
    const length = promptLength(prompt)
    if (kept.length >= budgets.max_prompts || usedChars + length > budgets.prompt_chars) {
      return false
    }
    kept.push(prompt)
    keptSet.add(prompt)
    usedChars += length
    return true
  }

  for (const prompt of context.prompts) {
    if (firstBySession.get(sessionKey(prompt)) !== prompt) continue
    if (!canKeep(prompt)) droppedByBudget += 1
  }
  for (let i = context.prompts.length - 1; i >= 0; i--) {
    const prompt = context.prompts[i]
    if (keptSet.has(prompt)) continue
    if (!canKeep(prompt)) droppedByBudget += 1
  }
  kept.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  context.prompts = kept
  if (droppedByBudget > 0) {
    context.truncation.prompts_dropped += droppedByBudget
    context.warnings.push(
      `Kept each session's first prompt plus the newest records within the prompt budget; dropped ${droppedByBudget} prompt(s)`,
    )
  }

  if (serializedLen(context) > budgets.total_chars && context.project.readme_excerpt !== null) {
    context.project.readme_excerpt = null
    context.truncation.readme_truncated = true
    context.warnings.push('Total context exceeded the budget; removed the README excerpt')
  }

  const droppedBeforeTotalBudget = context.truncation.prompts_dropped
  while (serializedLen(context) > budgets.total_chars && context.prompts.length > 0) {
    context.prompts.shift()
    context.truncation.prompts_dropped += 1
  }
  const additionallyDropped = context.truncation.prompts_dropped - droppedBeforeTotalBudget
  if (additionallyDropped > 0) {
    context.warnings.push(
      `Total context exceeded the budget; dropped ${additionallyDropped} additional older prompt(s)`,
    )
  }
}

export function serializedLen(context: ReportContext): number {
  return JSON.stringify(context).length
}
