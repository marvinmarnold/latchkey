import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Latchkey Admin' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', background: '#0f0f0f', color: '#e5e5e5' }}>
        {children}
      </body>
    </html>
  )
}
