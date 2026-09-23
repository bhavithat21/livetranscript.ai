import { SignUp } from '@clerk/nextjs'
import { AuthShell, AuthUnavailable } from '@/components/site/AuthShell'

export const metadata = { title: 'Create an account — LiveTranscript' }

export default function SignUpPage() {
  return <AuthShell>{process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <SignUp /> : <AuthUnavailable />}</AuthShell>
}
