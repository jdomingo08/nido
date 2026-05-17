export type FinancesErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'plaid_error'
  | 'storage_error'
  | 'encryption_error'

export class FinancesError extends Error {
  readonly code: FinancesErrorCode
  readonly status: number
  readonly cause?: unknown

  constructor(code: FinancesErrorCode, message: string, status = 500, cause?: unknown) {
    super(message)
    this.name = 'FinancesError'
    this.code = code
    this.status = status
    this.cause = cause
  }
}

export function unauthenticated(): FinancesError {
  return new FinancesError('unauthenticated', 'Not authenticated', 401)
}

export function forbidden(reason: string): FinancesError {
  return new FinancesError('forbidden', reason, 403)
}

export function invalidInput(reason: string): FinancesError {
  return new FinancesError('invalid_input', reason, 400)
}

export function plaidFailure(message: string, cause: unknown): FinancesError {
  return new FinancesError('plaid_error', message, 502, cause)
}
