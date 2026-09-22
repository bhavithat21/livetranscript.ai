import { emptyScreenSnapshot, mergeScreenObservation, screenFileSummary, type ScreenObservation } from '../../lib/repo/screenEvidence'
import type { VisionFixture } from './fixtures'

type SourceLine = { key: string; text: string }
const lines = (observation: ScreenObservation): SourceLine[] => {
  const unanchored = new Map<string, number>()
  return observation.files.flatMap((file) => file.lines.map((text, index) => {
    const offset = unanchored.get(file.path) ?? 0
    if (file.startLine === null) unanchored.set(file.path, offset + 1)
    return { key: `${file.path}\u0000${file.startLine === null ? `unknown:${offset}` : file.startLine + index}`, text }
  }))
}
const paths = (observation: ScreenObservation) => new Set([...observation.visiblePaths, ...observation.files.map((file) => file.path)])
const proportion = (hits: number, total: number) => total === 0 ? 1 : hits / total

/** Exact characters matter: !=, !==, punctuation, whitespace and identifier case are not normalized. */
export function characterDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let index = 0; index < left.length; index++) {
    const next = [index + 1]
    for (let offset = 0; offset < right.length; offset++) {
      next.push(Math.min(next[offset] + 1, previous[offset + 1] + 1, previous[offset] + Number(left[index] !== right[offset])))
    }
    previous = next
  }
  return previous[right.length]
}

export interface VisionScore {
  exactFrame: boolean
  characterAccuracy: number
  exactLinePrecision: number
  exactLineRecall: number
  anchorPrecision: number
  anchorRecall: number
  pathPrecision: number
  pathRecall: number
  unsupportedLines: number
  inventedPaths: number
  falseEofClaims: number
  missingEofClaims: number
  terminalExact: boolean
  requirementsExact: boolean
  conflictRetired: boolean | null
}

export function scoreVisionFixture(fixture: VisionFixture, actual: ScreenObservation, previous?: ScreenObservation): VisionScore {
  const expected = fixture.expected
  const reference = lines(expected)
  const observed = lines(actual)
  const remaining = new Map(reference.map((line) => [line.key, line.text]))
  let matches = 0
  let anchors = 0
  let characters = 0
  let edits = 0
  let unsupportedLines = 0
  for (const line of observed) {
    if (remaining.has(line.key)) {
      const target = remaining.get(line.key)!
      anchors++
      if (target === line.text) matches++
      edits += characterDistance(target, line.text)
      characters += Math.max(target.length, line.text.length, 1)
      remaining.delete(line.key)
    } else {
      unsupportedLines++
      edits += Math.max(line.text.length, 1)
      characters += Math.max(line.text.length, 1)
    }
  }
  for (const text of remaining.values()) { edits += Math.max(text.length, 1); characters += Math.max(text.length, 1) }
  const referencePaths = paths(expected)
  const observedPaths = paths(actual)
  const pathHits = [...observedPaths].filter((path) => referencePaths.has(path)).length
  const eofKeys = (observation: ScreenObservation) => new Set(observation.files.filter((file) => file.endOfFile).map((file) => `${file.path}:${file.startLine === null ? 'unknown' : file.startLine + file.lines.length - 1}`))
  const expectedEof = eofKeys(expected)
  const observedEof = eofKeys(actual)
  const falseEofClaims = [...observedEof].filter((key) => !expectedEof.has(key)).length
  const missingEofClaims = [...expectedEof].filter((key) => !observedEof.has(key)).length
  const terminalExact = expected.terminal.trim() === actual.terminal.trim()
  const requirementsExact = JSON.stringify([...expected.requirements].sort()) === JSON.stringify([...actual.requirements].sort())
  let conflictRetired: boolean | null = null
  if (fixture.previousFixture) {
    conflictRetired = false
    if (previous) {
      const snapshot = mergeScreenObservation(mergeScreenObservation(emptyScreenSnapshot(), previous), actual)
      const file = snapshot.files.find((entry) => entry.path === expected.files[0]?.path)
      conflictRetired = Boolean(file && file.staleFragments.length > 0 && screenFileSummary(file).hasConflicts && !screenFileSummary(file).complete)
    }
  }
  return {
    exactFrame: matches === reference.length && matches === observed.length && referencePaths.size === pathHits && observedPaths.size === pathHits
      && falseEofClaims === 0 && missingEofClaims === 0 && terminalExact && requirementsExact && conflictRetired !== false,
    characterAccuracy: characters === 0 ? 1 : Math.max(0, 1 - edits / characters),
    exactLinePrecision: proportion(matches, observed.length), exactLineRecall: proportion(matches, reference.length),
    anchorPrecision: proportion(anchors, observed.length), anchorRecall: proportion(anchors, reference.length),
    pathPrecision: proportion(pathHits, observedPaths.size), pathRecall: proportion(pathHits, referencePaths.size),
    unsupportedLines, inventedPaths: observedPaths.size - pathHits, falseEofClaims, missingEofClaims, terminalExact, requirementsExact, conflictRetired,
  }
}
