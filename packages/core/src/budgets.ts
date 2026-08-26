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

/** Budget algorithm: truncate each prompt, keep the newest, then drop the README before older prompts when over the total budget. */
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

  const kept: UserPrompt[] = []
  let usedChars = 0
  for (let i = context.prompts.length - 1; i >= 0; i--) {
    const prompt = context.prompts[i]
    const length = Array.from(prompt.text).length
    if (
      kept.length >= budgets.max_prompts
      || usedChars + length > budgets.prompt_chars
    ) {
      context.truncation.prompts_dropped += 1
      continue
    }
    usedChars += length
    kept.push(prompt)
  }
  kept.reverse()
  context.prompts = kept
  if (context.truncation.prompts_dropped > 0) {
    context.warnings.push(
      `Kept the newest records within the prompt budget; dropped ${context.truncation.prompts_dropped} older prompt(s)`,
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
  if (serializedLen(context) > budgets.total_chars) {
    context.warnings.push('Git evidence alone exceeds the total context budget; kept it intact to preserve evidence')
  }
}

export function serializedLen(context: ReportContext): number {
  return JSON.stringify(context).length
}
