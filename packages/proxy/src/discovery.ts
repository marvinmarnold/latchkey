import type { Database } from 'bun:sqlite'

type EndpointConfig = {
  provider_id: string
  endpoint: string
  upstream_format: 'openai' | 'anthropic'
  api_key: string | null
  price_input_usd_per_million: number
  price_output_usd_per_million: number
}

export async function discoverModels(db: Database): Promise<void> {
  // One row per distinct (provider, endpoint, format, key) combination
  const endpoints = db
    .query<EndpointConfig, []>(`
      SELECT provider_id, endpoint, upstream_format, api_key,
             COALESCE(AVG(price_input_usd_per_million), 0) AS price_input_usd_per_million,
             COALESCE(AVG(price_output_usd_per_million), 0) AS price_output_usd_per_million
      FROM listings
      WHERE active = 1
      GROUP BY provider_id, endpoint, upstream_format, api_key
    `)
    .all()

  await Promise.allSettled(endpoints.map(ep => discoverEndpoint(db, ep)))
}

async function discoverEndpoint(db: Database, ep: EndpointConfig): Promise<void> {
  if (!ep.api_key) {
    console.log(`[discovery] ${ep.endpoint}: no api_key, skipping`)
    return
  }

  try {
    const modelIds = await fetchModelIds(ep as EndpointConfig & { api_key: string })
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO listings
        (id, provider_id, model_id, upstream_format, endpoint, api_key, price_input_usd_per_million, price_output_usd_per_million)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const modelId of modelIds) {
      stmt.run(
        makeListingId(ep, modelId),
        ep.provider_id,
        modelId,
        ep.upstream_format,
        ep.endpoint,
        ep.api_key,
        ep.price_input_usd_per_million,
        ep.price_output_usd_per_million,
      )
    }
    console.log(`[discovery] ${ep.endpoint}: ${modelIds.length} models`)
  } catch (e) {
    console.warn(`[discovery] ${ep.endpoint}: ${(e as Error).message}`)
  }
}

async function fetchModelIds(ep: EndpointConfig & { api_key: string }): Promise<string[]> {
  const headers: Record<string, string> = {}

  // Anthropic endpoint is stored without /v1 (forwarder appends /v1/messages);
  // OpenAI-compat endpoints are stored with /v1 already included.
  let modelsUrl: string
  if (ep.upstream_format === 'anthropic') {
    headers['x-api-key'] = ep.api_key
    headers['anthropic-version'] = '2023-06-01'
    modelsUrl = `${ep.endpoint}/v1/models`
  } else {
    headers['Authorization'] = `Bearer ${ep.api_key}`
    modelsUrl = `${ep.endpoint}/models`
  }

  const res = await fetch(modelsUrl, {
    headers,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

  const json = await res.json() as { data?: Array<{ id: string }> }
  if (!Array.isArray(json.data)) throw new Error('unexpected /models response shape')
  return json.data.map(m => m.id)
}

function makeListingId(ep: EndpointConfig, modelId: string): string {
  const host = new URL(ep.endpoint).hostname.replace(/\./g, '-')
  return `disc-${ep.provider_id}-${host}-${modelId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
}
