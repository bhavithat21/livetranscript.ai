/** Provider-constrained shape; evidence safety and size limits are still checked locally. */
export const SCREEN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['files', 'visiblePaths', 'terminal', 'requirements'],
  properties: {
    files: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['path', 'language', 'startLine', 'lines', 'confidence', 'endOfFile'],
      properties: {
        path: { type: 'string', description: 'Exact visible relative file path; never invent one.' },
        language: { type: 'string', description: 'Short identifier such as java or typescript, without spaces.' },
        startLine: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        lines: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' }, endOfFile: { type: 'boolean' },
      },
    } },
    visiblePaths: { type: 'array', items: { type: 'string' } },
    terminal: { type: 'string' }, requirements: { type: 'array', items: { type: 'string' } },
  },
}
