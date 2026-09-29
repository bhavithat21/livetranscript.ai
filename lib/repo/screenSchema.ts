/** Constraints not supported by the provider grammar remain explicit value rules.
 * parseScreenObservation is still the strict trust boundary; never weaken it. */
export const SCREEN_VALUE_RULES = `Local evidence value rules:
- files: at most 12 fragments. Each needs an actually visible safe relative path and 1..240 visible source lines. Put tree-only entries in visiblePaths, never files with empty lines.
- Paths: at most 320 characters; no absolute paths, colons, leading/trailing whitespace, empty segments, . or .. segments, or __proto__/constructor/prototype segments. Omit unknown/unsafe paths rather than guessing replacements. Do not expose credential files.
- language: 1..40 characters matching letters, digits, underscore, +, #, dot or hyphen. Use a short identifier such as java, typescript or text, not a display label such as Java (OpenJDK 21).
- startLine: null when no numeric gutter is visible; otherwise an integer from 1..100000, with the entire observed range <=100000. Never use 0 or guess an anchor.
- lines: preserve each actual source line as one string, <=2000 characters, without embedded CR/LF. Preserve indentation and blank lines; do not reconstruct clipped code.
- confidence: a number from 0..1, not a percentage. endOfFile: boolean; true only when the file end is visibly established.
- visiblePaths: at most 300 safe paths. terminal: <=12000 characters. requirements: at most 30 strings of <=1000 characters each. Total evidence <=100000 characters.
- No control characters except tab/CR/LF in multiline text; source lines themselves cannot contain CR/LF. When evidence is absent use empty arrays and an empty terminal string.`

export const SCREEN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['files', 'visiblePaths', 'terminal', 'requirements'],
  properties: {
    files: { type: 'array', description: 'At most 12 visible source fragments; omit unknown paths and empty fragments.', items: {
      type: 'object', additionalProperties: false,
      required: ['path', 'language', 'startLine', 'lines', 'confidence', 'endOfFile'],
      properties: {
        path: { type: 'string', description: 'Exact visible safe relative file path, <=320 characters. Never invent one.' },
        language: { type: 'string', pattern: '^[a-zA-Z0-9_+#.-]+$', description: 'Short identifier, 1..40 characters, e.g. java or typescript; use text when uncertain.' },
        startLine: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Visible numeric gutter label from 1..100000; otherwise null. Never 0.' },
        lines: { type: 'array', minItems: 1, description: '1..240 source lines, <=2000 characters each; no reconstructed/clipped lines.', items: { type: 'string', pattern: '^[^\\r\\n]*$' } },
        confidence: { type: 'number', description: 'Transcription confidence from 0..1, never a percentage.' },
        endOfFile: { type: 'boolean', description: 'True only when the actual file end is visibly established.' },
      },
    } },
    visiblePaths: { type: 'array', description: 'At most 300 exact visible safe relative paths, each <=320 characters.', items: { type: 'string' } },
    terminal: { type: 'string', description: 'Visible command/output only, <=12000 characters; empty when absent.' },
    requirements: { type: 'array', description: 'At most 30 visible requirements, each <=1000 characters.', items: { type: 'string' } },
  },
}
