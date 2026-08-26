export type YaoheErrorCode =
  | 'NO_ACTIVITY'
  | 'CONFIG_INVALID'
  | 'COLLECTION_FAILED'
  | 'GENERATOR_FAILED'
  | 'OUTPUT_FAILED'
  | 'TIMEOUT'

export class YaoheError extends Error {
  readonly code: YaoheErrorCode

  constructor(message: string, code: YaoheErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'YaoheError'
    this.code = code
  }
}
