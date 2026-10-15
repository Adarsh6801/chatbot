import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title: 'AgentForge — Your knowledge, in conversation', description: 'Build, train, and deploy a support agent grounded in your own documents.'};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
