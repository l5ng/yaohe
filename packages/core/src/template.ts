import { readFile } from 'node:fs/promises'

export type TemplateLanguage = 'en' | 'zh'
export type TemplateLanguageChoice = TemplateLanguage | 'auto'

function defaultTemplateFile(language: TemplateLanguage): URL {
  return new URL(`../templates/default.${language}.md`, import.meta.url)
}

export function renderTemplate(raw: string, date: string, project: string): string {
  return raw.replaceAll('{{date}}', date).replaceAll('{{project}}', project)
}

function envValue(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() !== '' ? value : undefined
}

/** Content-based language detection: any Han (CJK) character makes the template Chinese. */
export function detectTemplateLanguage(template: string): TemplateLanguage {
  return /\p{Script=Han}/u.test(template) ? 'zh' : 'en'
}

/** Detect the user's language from the system locale; only en/zh are supported, everything else falls back to en. */
export function detectUserLanguage(): TemplateLanguage {
  const locale = envValue('LC_ALL')
    ?? envValue('LC_MESSAGES')
    ?? envValue('LANG')
    ?? Intl.DateTimeFormat().resolvedOptions().locale
  return /^zh([-_]|$)/i.test(locale) ? 'zh' : 'en'
}

export async function loadTemplate(
  spec: string | undefined,
  date: string,
  project: string,
  defaultLanguage: TemplateLanguage = 'en',
): Promise<string> {
  const raw = spec === undefined
    ? await readFile(defaultTemplateFile(defaultLanguage), 'utf8')
    : spec === '-'
      ? await readStdin()
      : await readFile(spec, 'utf8').catch((error: NodeJS.ErrnoException) => {
        throw new Error(`Failed to read template file ${spec}: ${error.message}`)
      })
  if (raw.trim() === '') {
    throw new Error('Report template cannot be empty')
  }
  return renderTemplate(raw, date, project)
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk: string) => {
      text += chunk
    })
    process.stdin.on('end', () => resolve(text))
    process.stdin.on('error', reject)
  })
}
