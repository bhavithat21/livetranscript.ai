// Colors hand-picked for AA (>=4.5:1) on light (#faf9f7) and dark (#16151a)
// backgrounds and checked against deuteranopia/protanopia. Re-validate if bg changes.
export const SPEAKER_PALETTE = {
  speakers: [
    { name: 'Speaker 1', light: '#1d4ed8', dark: '#93c5fd' }, // ink blue
    { name: 'Speaker 2', light: '#b45309', dark: '#fdba74' }, // rust orange
    { name: 'Speaker 3', light: '#0f766e', dark: '#5eead4' }, // teal green
    { name: 'Speaker 4', light: '#7c3aed', dark: '#c4b5fd' }, // violet
    { name: 'Speaker 5', light: '#a16207', dark: '#fde047' }, // amber/ochre
  ],
  neutral: { light: '#3f3f46', dark: '#d4d4d8' },
} as const

export function speakerColor(index: number, theme: 'light' | 'dark') {
  const s = SPEAKER_PALETTE.speakers[index]
  if (!s) return { color: SPEAKER_PALETTE.neutral[theme], name: `Speaker ${index + 1}` }
  return { color: s[theme], name: s.name }
}
