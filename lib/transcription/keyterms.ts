// Back-compat: the default keyterm set is now the resolved default packs.
// Live pages use useKeytermPrefs (user-selected packs); this stays for any
// non-React caller that wants a sensible static list.
import { DEFAULT_PACK_IDS, resolveKeyterms } from './keytermPacks'

export const KEYTERMS: string[] = resolveKeyterms(DEFAULT_PACK_IDS)
