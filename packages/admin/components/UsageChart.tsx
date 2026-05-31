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

export default function UsageChart({ title, rows }: { title: string; rows: UsageRow[] }) {
  const data = pivot(rows)
  const keys = [...new Set(rows.map(r => truncateKey(r.key)))]

  return (
    <div style={{ marginBottom: '3rem' }}>
      <h2 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600, color: '#a3a3a3' }}>
        {title}
      </h2>
      <ResponsiveContainer width="100%" height={280}>
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
    </div>
  )
}
