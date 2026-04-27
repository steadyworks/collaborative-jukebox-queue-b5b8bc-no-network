export const metadata = { title: 'Collaborative Jukebox' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'sans-serif', background: '#1a1a2e', color: '#eee', minHeight: '100vh' }}>
        {children}
      </body>
    </html>
  )
}
