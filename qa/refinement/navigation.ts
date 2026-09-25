// QA-only router boundary. The actual AppNav renders at the public home route.
export const usePathname = () => '/'
const unsupported = () => { throw new Error('QA router writes are not supported') }
export const useRouter = () => ({ push: unsupported, replace: unsupported, refresh: unsupported, prefetch: unsupported })
export const useSelectedLayoutSegments = () => []
export const redirect = unsupported
export const RedirectType = { push: 'push', replace: 'replace' }
