export const PROFILE_FIELDS = {
  resume: { label: 'Resume and experience', limit: 12_000 },
  jd: { label: 'Target job description', limit: 8_000 },
} as const
export type ProfileField = keyof typeof PROFILE_FIELDS

// Matches the existing useCandidateProfile prompt/storage limits. Imports reject
// oversized text instead of silently discarding the end of a resume or job brief.
export async function readProfileText(file: File, field: ProfileField): Promise<string> {
  if (!/\.(txt|md)$/i.test(file.name) || (file.type && !['text/plain', 'text/markdown', 'text/x-markdown'].includes(file.type))) {
    throw new Error('Choose a .txt or .md file. For PDF or Word, copy and paste the text below.')
  }
  if (!file.size || file.size > 64 * 1024) throw new Error('Choose a text file smaller than 64 KB.')
  const text = await file.text()
  if (!text.trim() || text.includes('\u0000')) throw new Error('This file has no readable text. Choose another file or paste the text below.')
  if (text.length > PROFILE_FIELDS[field].limit) {
    throw new Error(`Keep this text within ${PROFILE_FIELDS[field].limit.toLocaleString('en-US')} characters. Shorten the file or paste a relevant excerpt below.`)
  }
  return text
}
