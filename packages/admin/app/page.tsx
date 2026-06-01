'use client'

import { useEffect, useState } from 'react'
import UsageChart, { type UsageRow } from '../components/UsageChart'
import WalletTable, { type WalletRow } from '../components/WalletTable'

type UsageData = {
  byWallet: UsageRow[]
  byProvider: UsageRow[]
  byModel: UsageRow[]
}

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? 'http://localhost:3000'

export default function AdminPage() {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [wallets, setWallets] = useState<WalletRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${PROXY}/admin/usage`)
      .then(r => { if (!r.ok) throw new Error(`usage HTTP ${r.status}`); return r.json() as Promise<UsageData> })
      .then(setUsage)
      .catch((e: Error) => setError(e.message))

    fetch(`${PROXY}/admin/wallets`)
      .then(r => { if (!r.ok) throw new Error(`wallets HTTP ${r.status}`); return r.json() as Promise<WalletRow[]> })
      .then(async rows => {
        // Enrich each row with its live allowance (best-effort — silently skipped on failure)
        const enriched = await Promise.all(
          rows.map(async row => {
            try {
              const res = await fetch(`${PROXY}/admin/allowance/${row.address}`)
              if (res.ok) {
                const { allowance_atomic } = await res.json() as { allowance_atomic: string }
                return { ...row, allowance_atomic }
              }
            } catch { /* non-fatal */ }
            return row
          })
        )
        setWallets(enriched)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '2.5rem' }}>
        Latchkey — last 30 days
      </h1>

      {error && <p style={{ color: '#f43f5e' }}>Failed to load: {error}</p>}

      {/* Wallet billing state (Phase 2) */}
      <h2 style={{ fontSize: '0.8rem', fontWeight: 600, color: '#a3a3a3', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
        Wallet billing state
      </h2>
      {wallets === null && !error && <p style={{ color: '#737373', fontSize: 13 }}>Loading…</p>}
      {wallets !== null && <WalletTable rows={wallets} />}

      <div style={{ marginTop: '3rem' }}>
        {!usage && !error && <p style={{ color: '#737373' }}>Loading charts…</p>}
        {usage && (
          <>
            <UsageChart title="Tokens by Wallet" rows={usage.byWallet} />
            <UsageChart title="Tokens by Provider" rows={usage.byProvider} />
            <UsageChart title="Tokens by Model" rows={usage.byModel} />
          </>
        )}
      </div>
    </main>
  )
}
