import { expect, it } from 'vitest'
import { REFERENCE_VIDEO, youtubeReference } from './videoReference'
it('accepts only public YouTube URL shapes and normalizes extras away', () => {
  const expected = youtubeReference(REFERENCE_VIDEO)
  expect(youtubeReference('https://youtu.be/ZE_YEn-okfk?t=90')).toEqual(expected)
  expect(youtubeReference('https://www.youtube.com/shorts/ZE_YEn-okfk')).toEqual(expected)
  expect(expected.embed).toContain('youtube-nocookie.com')
})
it.each(['https://evil.test/?v=ZE_YEn-okfk', 'https://youtube.com.evil.test/watch?v=ZE_YEn-okfk', 'http://youtube.com/watch?v=ZE_YEn-okfk', 'https://user:pass@youtube.com/watch?v=ZE_YEn-okfk', 'https://youtube.com/playlist?list=abc', 'file:///etc/passwd', 'https://youtube.com/watch?v=x'])('rejects untrusted reference %s', url => { expect(() => youtubeReference(url)).toThrow() })
