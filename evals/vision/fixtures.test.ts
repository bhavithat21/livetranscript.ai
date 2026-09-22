// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseScreenObservation } from '../../lib/repo/screenEvidence'
import { visionFixtures } from './fixtures'
import { characterDistance, scoreVisionFixture } from './score'
import { renderVisionFixture } from './render'

describe('vision benchmark ground truth and scoring', () => {
  it('accepts every ground-truth fixture with strict production validation and scores exact evidence', () => {
    for (const fixture of visionFixtures) {
      const expected = parseScreenObservation(fixture.expected)
      const previous = visionFixtures.find((entry) => entry.id === fixture.previousFixture)?.expected
      expect(scoreVisionFixture(fixture, expected, previous), fixture.id).toMatchObject({ exactFrame: true, characterAccuracy: 1, exactLineRecall: 1, unsupportedLines: 0, inventedPaths: 0 })
    }
  })
  it('penalizes changed operators, guessed anchors and extra paths independently', () => {
    const fixture = visionFixtures[0]
    const actual = structuredClone(fixture.expected)
    actual.files[0].lines[2] = actual.files[0].lines[2].replace('===', '!==')
    const punctuation = scoreVisionFixture(fixture, actual)
    expect(punctuation.exactFrame).toBe(false)
    expect(punctuation.characterAccuracy).toBeLessThan(1)
    expect(punctuation.anchorRecall).toBe(1)
    expect(punctuation.exactLineRecall).toBe(0.8)

    const noGutter = visionFixtures.find((entry) => entry.id === 'missing-gutter')!
    const invented = structuredClone(noGutter.expected)
    invented.files[0].startLine = 1
    invented.visiblePaths.push('src/imagined.ts')
    expect(scoreVisionFixture(noGutter, invented)).toMatchObject({ exactFrame: false, anchorRecall: 0, inventedPaths: 1, unsupportedLines: 2 })
  })
  it('does not reward omissions, duplicate lines, inferred EOF or missing conflict evidence', () => {
    const fixture = visionFixtures[0]
    expect(scoreVisionFixture(fixture, { files: [], visiblePaths: [], requirements: [], terminal: '' }).exactFrame).toBe(false)
    const duplicate = structuredClone(fixture.expected)
    duplicate.files.push(structuredClone(duplicate.files[0]))
    duplicate.files[0].endOfFile = true
    expect(scoreVisionFixture(fixture, duplicate)).toMatchObject({ exactFrame: false, unsupportedLines: 5, falseEofClaims: 1 })
    const changed = visionFixtures.find((entry) => entry.previousFixture)!
    expect(scoreVisionFixture(changed, changed.expected)).toMatchObject({ exactFrame: false, conflictRetired: false })
  })
  it('generates actual PNG bytes reproducibly for the same installed renderer', async () => {
    const first = await renderVisionFixture(visionFixtures[0])
    const second = await renderVisionFixture(visionFixtures[0])
    expect(first.png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(second.sha256).toBe(first.sha256)
    expect(first.png.length).toBeGreaterThan(1000)
  })
  it('treats punctuation and whitespace as meaningful characters', () => {
    expect(characterDistance('a !== b', 'a != b')).toBe(1)
    expect(characterDistance('  x', 'x')).toBe(2)
    expect(characterDistance('', 'abc')).toBe(3)
  })
})
