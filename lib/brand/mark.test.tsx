import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BrandMark } from '@/components/brand/BrandMark'
import { BRAND_ICON_SVG, CAPTION_MARK_PATH } from './mark'
import { DEFAULT_ICON_DATA_URL } from '@/lib/appIdentity/icons'

describe('caption identity', () => {
  it('shares owned vector geometry between the web mark and route favicon', () => {
    expect(renderToStaticMarkup(<BrandMark/>)).toContain(CAPTION_MARK_PATH)
    expect(readFileSync('app/icon.svg','utf8').trim()).toBe(BRAND_ICON_SVG)
  })
  it('uses the same raster mark for the default saved preference and favicon effect', () => {
    expect(DEFAULT_ICON_DATA_URL).toBe('data:image/png;base64,'+readFileSync('public/brand/icon.png').toString('base64'))
  })
  it('keeps primary brand tokens out of blue/cyan/indigo hue ranges in both themes', () => {
    const css=readFileSync('app/globals.css','utf8')
    const colors=[...css.matchAll(/--(?:paper|ink|reader|signal|primary-fill|primary-hover|brand-citrus|brand-ink):\s*(#[\da-f]{6})/gi)]
    expect(colors.length).toBeGreaterThan(15)
    for(const [,hex] of colors) {
      const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
      const max=Math.max(r,g,b), min=Math.min(r,g,b), delta=max-min
      if(delta<.03) continue
      const hue=(((max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4)*60)%360+360)%360
      expect(hue<175||hue>295,hex).toBe(true)
    }
  })
})
