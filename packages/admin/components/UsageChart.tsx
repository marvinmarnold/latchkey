'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export type UsageRow = { date: string; key: string; tokens: number }

const COLORS = ['#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#a78bfa', '#34d399']

function truncateKey(key: string): string {
  if (key.startsWith('0x') && key.length > 12) {
    return `${key.slice(0, 6)}…${key.slice(-4)}`
  }
  return key
}

function pivot(rows: UsageRow[]): Record<string, string | number>[] {
  const dates = [...new Set(rows.map(r => r.date))].sort()
  const keys = [...new Set(rows.map(r => r.key))]
  return dates.map(date => {
    const point: Record<string, string | number> = { date }
    for (const key of keys) {
      const row = rows.find(r => r.date === date && r.key === key)
      point[truncateKey(key)] = row?.tokens ?? 0
    }
    return point
  })
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
  marginTop: '1rem',
}
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.35rem 0.75rem',
  color: '#525252',
  fontWeight: 500,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid #262626',
}
const tdStyle: React.CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #1a1a1a',
  color: '#d4d4d4',
  fontFamily: 'monospace',
  fontSize: 12,
}

export default function UsageChart({ title, rows }: { title: string; rows: UsageRow[] }) {
  const data = pivot(rows)
  const keys = [...new Set(rows.map(r => truncateKey(r.key)))]

  // Sort table rows: most recent date first, then by tokens desc
  const sorted = [...rows].sort((a, b) =>
    b.date.localeCompare(a.date) || b.tokens - a.tokens,
  )

  return (
    <div style={{ marginBottom: '3.5rem' }}>
      <h2 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600, color: '#a3a3a3' }}>
        {title}
      </h2>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#737373' }} />
          <YAxis tick={{ fontSize: 11, fill: '#737373' }} />
          <Tooltip
            contentStyle={{ background: '#1c1c1c', border: '1px solid #333', borderRadius: 6 }}
            labelStyle={{ color: '#e5e5e5' }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#a3a3a3' }} />
          {keys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={COLORS[i % COLORS.length]}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {sorted.length > 0 && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Key</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i}>
                <td style={tdStyle}>{row.date}</td>
                <td style={{ ...tdStyle, color: '#a5f3fc' }}>{row.key}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{row.tokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
