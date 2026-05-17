import 'server-only'
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

let cachedClient: PlaidApi | undefined

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return v
}

function pickSecret(env: string): string {
  if (env === 'production') {
    return requireEnv('PLAID_SECRET_PRODUCTION')
  }
  // sandbox + development share the sandbox secret on the Trial plan
  return requireEnv('PLAID_SECRET_SANDBOX')
}

export function getPlaidClient(): PlaidApi {
  if (cachedClient) return cachedClient

  const env = (process.env.PLAID_ENV ?? 'sandbox').toLowerCase()
  if (!(env in PlaidEnvironments)) {
    throw new Error(`Unknown PLAID_ENV: ${env}`)
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': requireEnv('PLAID_CLIENT_ID'),
        'PLAID-SECRET': pickSecret(env)
      }
    }
  })

  cachedClient = new PlaidApi(configuration)
  return cachedClient
}

export function plaidCountryCodes(): string[] {
  return (process.env.PLAID_COUNTRY_CODES ?? 'US')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
}

export function plaidProducts(): string[] {
  return (process.env.PLAID_PRODUCTS ?? 'transactions')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
}
