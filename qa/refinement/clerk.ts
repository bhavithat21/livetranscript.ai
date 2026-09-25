// Explicit QA boundary: this suite renders the signed-out, unconfigured shell.
// Never simulate authentication or silently render a configured auth component.
const unconfigured = (): never => { throw new Error('Clerk is outside the presentation fixture; use authenticated E2E coverage') }
export const Show = unconfigured
export const UserButton = unconfigured
export const useUser = unconfigured
