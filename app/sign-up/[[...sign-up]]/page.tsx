import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#faf9f7] px-6 py-16">
      <SignUp />
    </main>
  )
}
