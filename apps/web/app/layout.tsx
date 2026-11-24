import type { Metadata } from 'next';
import AppShell from '@/components/AppShell';
import { DialogProvider } from '@/components/Dialogs';
import './globals.css';
export const metadata: Metadata = {title: 'AgentForge — Your knowledge, in conversation', description: 'Build, train, and deploy a support agent grounded in your own documents.'};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body><DialogProvider><AppShell>{children}</AppShell></DialogProvider></body></html>;
}
