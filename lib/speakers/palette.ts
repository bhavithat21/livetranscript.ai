// Colors hand-picked for AA (>=4.5:1) on light (#faf9f7) and dark (#16151a)
// backgrounds and checked against deuteranopia/protanopia. Re-validate if bg changes.
export const SPEAKER_PALETTE = {
  speakers: [
    { name: 'Speaker 1', light: '#a53c25', dark: '#ffb397' }, // terracotta
    { name: 'Speaker 2', light: '#526127', dark: '#d6e384' }, // olive/citrus
    { name: 'Speaker 3', light: '#8a5820', dark: '#efd08b' }, // ochre
    { name: 'Speaker 4', light: '#9b3651', dark: '#f2a9b8' }, // rose
    { name: 'Speaker 5', light: '#425b42', dark: '#b6d3a7' }, // moss
  ],
  neutral: { light: '#494c40', dark: '#d2d5c7' },
} as const

export function speakerColor(index: number, theme: 'light' | 'dark') {
  const s = SPEAKER_PALETTE.speakers[index]
  if (!s) return { color: SPEAKER_PALETTE.neutral[theme], name: `Speaker ${index + 1}` }
  return { color: s[theme], name: s.name }
}
