import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Approval — human-in-the-loop cho thay đổi hạ tầng',
  description:
    'Agent đề xuất dependency bump, bulk email, config change; con người duyệt trước khi apply, state machine bền vững và resume sau restart.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
