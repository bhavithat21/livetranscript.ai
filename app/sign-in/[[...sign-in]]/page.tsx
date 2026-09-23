import { SignIn } from '@clerk/nextjs'
import { AuthShell, AuthUnavailable } from '@/components/site/AuthShell'

export const metadata = { title: 'Sign in — LiveTranscript' }

export default function SignInPage() {
  return <AuthShell>{process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <SignIn /> : <AuthUnavailable />}</AuthShell>
}
