import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { getUser } from '@/lib/auth';

export default async function RegisterPage() {
  if (await getUser()) redirect('/workspace');
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <AuthForm mode="register" />
    </main>
  );
}
