import type { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'crypto'

// Deterministic probe: same prompt → same (or very similar) response from a given model.
// We hash the response to detect model swap (bait-and-switch).
const PROBE_PROMPT = 'Respond with exactly this text and nothing else: payprompt-fingerprint-v1'
const PROBE_HASH = createHash('sha256').update(PROBE_PROMPT).digest('hex')

interface Listing {
  id: string
  endpoint: string
  api_key: string | null
  upstream_format: string
  provider_model_id: string | null
  model_id: string | null
  model_prefix: string | null
}

async function probeModel(listing: Listing): Promise<string | null> {
  if (!listing.api_key) return null
  const modelId = listing.provider_model_id ?? listing.model_id ?? listing.model_prefix?.replace('-', '')
  if (!modelId) return null

  try {
    const body = JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: PROBE_PROMPT }],
      max_tokens: 50,
      temperature: 0,
    })
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    let url: string
    if (listing.upstream_format === 'anthropic') {
      url = `${listing.endpoint}/v1/messages`
      headers['x-api-key'] = listing.api_key
      headers['anthropic-version'] = '2023-06-01'
    } else {
      url = `${listing.endpoint}/chat/completions`
      headers['Authorization'] = `Bearer ${listing.api_key}`
    }

    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const json = await res.json() as Record<string, unknown>

    let text: string | undefined
    if (listing.upstream_format === 'anthropic') {
      const content = (json.content as Array<{ text?: string }> | undefined)?.[0]
      text = content?.text
    } else {
      const choices = (json.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]
      text = choices?.message?.content
    }
    if (!text) return null
    return createHash('sha256').update(text.trim()).digest('hex')
  } catch {
    return null
  }
}

/** Record or compare fingerprint for a listing. Logs a warning if hash changed. */
async function fingerprintListing(db: Database, listing: Listing): Promise<void> {
  const responseHash = await probeModel(listing)
  if (!responseHash) return

  const existing = db
    .query<{ response_hash: string }, [string]>(
      `SELECT response_hash FROM model_fingerprints WHERE listing_id = ? ORDER BY recorded_at DESC LIMIT 1`,
    )
    .get(listing.id)

  if (existing && existing.response_hash !== responseHash) {
    console.warn(`[fingerprint] MISMATCH for listing ${listing.id}: expected ${existing.response_hash.slice(0, 8)}… got ${responseHash.slice(0, 8)}…`)
  } else if (!existing) {
    console.log(`[fingerprint] recorded baseline for listing ${listing.id}`)
  }

  db.run(
    `INSERT INTO model_fingerprints (id, listing_id, prompt_hash, response_hash, recorded_at)
     VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), listing.id, PROBE_HASH, responseHash, Date.now()],
  )
}

/** Fingerprint all active listings with API keys. Called at startup and periodically. */
export async function fingerprintAllListings(db: Database): Promise<void> {
  const listings = db
    .query<Listing, []>(
      `SELECT l.id, l.endpoint, l.api_key, l.upstream_format, l.provider_model_id, l.model_id, l.model_prefix
       FROM listings l
       JOIN providers p ON p.id = l.provider_id
       WHERE l.active = 1 AND p.active = 1 AND l.api_key IS NOT NULL`,
    )
    .all()

  await Promise.allSettled(listings.map(l => fingerprintListing(db, l)))
}

/** Start periodic re-fingerprinting (default: every 6 hours). */
export function startFingerprintWorker(db: Database, intervalMs = 6 * 60 * 60 * 1000): ReturnType<typeof setInterval> {
  return setInterval(() => {
    fingerprintAllListings(db).catch(e => console.warn('[fingerprint]', (e as Error).message))
  }, intervalMs)
}
