'use client'

export type WalletRow = {
  address: string
  accrued_usd: number
  total_pulled_usd: number
  pull_failure_count: number
  last_pull_at: number | null
  last_pull_tx: string | null
  blocked: number
  allowance_atomic?: string  // from /admin/allowance/:address — optional (on-chain, may be unavailable)
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: '1rem' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '0.4rem 0.75rem', color: '#525252', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #262626' }
const tdStyle: React.CSSProperties = { padding: '0.4rem 0.75rem', borderBottom: '1px solid #141414', color: '#d4d4d4', fontFamily: 'monospace', fontSize: 12 }

function truncateAddr(addr: string) {
  if (addr.startsWith('0x') && addr.length > 14) return `${addr.slice(0, 8)}…${addr.slice(-6)}`
  return addr
}

function fmtUsd(n: number) { return `$${n.toFixed(6)}` }

function fmtAllowance(atomic: string | undefined) {
  if (!atomic) return '–'
  const n = Number(atomic) / 1_000_000
  return n > 99999 ? '∞ (unlimited)' : `$${n.toFixed(2)}`
}

export default function WalletTable({ rows }: { rows: WalletRow[] }) {
  if (rows.length === 0) return <p style={{ color: '#525252', fontSize: 13 }}>No wallets yet.</p>

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Wallet</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Accrued (off-chain)</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Lifetime pulled</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Allowance remaining</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Failures</th>
          <th style={thStyle}>Last pull tx</th>
          <th style={thStyle}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.address}>
            <td style={{ ...tdStyle, color: '#a5f3fc' }} title={r.address}>{truncateAddr(r.address)}</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtUsd(r.accrued_usd)}</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtUsd(r.total_pulled_usd)}</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtAllowance(r.allowance_atomic)}</td>
            <td style={{ ...tdStyle, textAlign: 'right' }}>{r.pull_failure_count}</td>
            <td style={tdStyle}>
              {r.last_pull_tx
                ? <a href={`https://sepolia.basescan.org/tx/${r.last_pull_tx}`} target="_blank" rel="noreferrer"
                    style={{ color: '#6366f1', fontFamily: 'monospace', fontSize: 11 }}>
                    {r.last_pull_tx.slice(0, 10)}…
                  </a>
                : <span style={{ color: '#525252' }}>—</span>}
            </td>
            <td style={{ ...tdStyle, color: r.blocked ? '#fca5a5' : '#86efac' }}>
              {r.blocked ? '🔒 blocked' : '✓ active'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
