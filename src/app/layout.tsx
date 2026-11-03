import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClearCart — Good finds. No guesswork.',
  description: 'Describe what you need. Review a thoughtful basket with every cost upfront. A sample shopping experience with optional PayPal Sandbox checkout.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
