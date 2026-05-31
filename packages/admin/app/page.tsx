'use client'

import { useEffect, useState } from 'react'
import UsageChart, { type UsageRow } from '../components/UsageChart'

type UsageData = {
  byWallet: UsageRow[]
  byProvider: UsageRow[]
  byModel: UsageRow[]
}

export default function AdminPage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const url = `${process.env.NEXT_PUBLIC_PROXY_URL ?? 'http://localhost:3000'}/admin/usage`
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<UsageData>
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '2.5rem' }}>
        Latchkey Usage — last 30 days
      </h1>

      {error && (
        <p style={{ color: '#f43f5e' }}>Failed to load: {error}</p>
      )}

      {!data && !error && (
        <p style={{ color: '#737373' }}>Loading…</p>
      )}

      {data && (
        <>
          <UsageChart title="Tokens by Wallet" rows={data.byWallet} />
          <UsageChart title="Tokens by Provider" rows={data.byProvider} />
          <UsageChart title="Tokens by Model" rows={data.byModel} />
        </>
      )}
    </main>
  )
}
