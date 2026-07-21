// Keyterm PACKS — the report's recommended strategy: one always-on base pack plus
// swappable overlays chosen per session. Each active combination stays under the
// 100-term provider cap, so users boost the vocabulary that matches THEIR context
// (a coding session vs a networking design review) without diluting the boost.
//
// LATENCY: keyterms are sent ONCE at connection open, never per word — so pack
// size has ZERO effect on live transcription latency. The 100-cap is about
// accuracy (dilution + provider truncation), not speed.

export interface KeytermPack {
  id: string
  name: string
  description: string
  base?: boolean // always on, can't be toggled off
  terms: string[]
}

export const PACKS: KeytermPack[] = [
  {
    id: 'base',
    name: 'Core tech',
    description: 'Always on — the jargon ASR most often mangles.',
    base: true,
    terms: [
      'Kubernetes', 'idempotency', 'quantization', 'observability', 'CI/CD', 'Docker',
      'low-latency', 'fault tolerance', 'event-driven architecture', 'API', 'SDK', 'OAuth',
      'PostgreSQL', 'Redis', 'GraphQL', 'webhook',
    ],
  },
  {
    id: 'aws',
    name: 'AWS & cloud',
    description: 'Amazon service names + streaming.',
    terms: [
      'AWS Lambda', 'Amazon ECS', 'Amazon EC2', 'Amazon S3', 'DynamoDB', 'CloudWatch',
      'AWS IAM', 'Apache Kafka', 'Apache Spark', 'partitioning', 'replication', 'quorum',
    ],
  },
  {
    id: 'coding',
    name: 'Coding & algorithms',
    description: 'Data-structures & algorithms vocabulary.',
    terms: [
      'Big O', 'HashMap', 'HashSet', 'two pointers', 'sliding window', 'BFS', 'DFS',
      'binary search', 'topological sort', 'dynamic programming', 'backtracking', 'Spring Boot',
    ],
  },
  {
    id: 'systems',
    name: 'System design',
    description: 'Distributed-systems trade-off language.',
    terms: [
      'consistent hashing', 'sharding', 'backpressure', 'circuit breaker',
      'jittered exponential backoff', 'fan-out', 'load shedding', 'control plane', 'data plane',
      'canary deployment', 'MTTR', 'P99',
    ],
  },
  {
    id: 'ai',
    name: 'AI / ML',
    description: 'LLM & retrieval terms.',
    terms: [
      'RAG', 'embeddings', 'vector database', 'FAISS', 'LangChain', 'few-shot prompting',
      'structured output', 'fine-tuning',
    ],
  },
  {
    id: 'realtime',
    name: 'Real-time media',
    description: 'WebRTC & networking acronyms.',
    terms: ['WebRTC', 'SFU', 'STUN', 'TURN', 'ICE', 'SDP', 'DTLS-SRTP', 'RTP', 'RTCP', 'signaling'],
  },
  {
    id: 'amazon',
    name: 'Amazon & Leadership',
    description: 'Leadership Principles & operations vocabulary.',
    terms: ['Bar Raiser', 'Leadership Principles', 'operational excellence', 'Tier-1 service'],
  },
]

export const DEFAULT_PACK_IDS = ['base', 'aws', 'coding', 'systems']
const KEYTERM_CAP = 100

// Merge the enabled packs (base always included), dedupe, and cap at 100 so no
// provider silently truncates. Order preserved: base first, then overlays.
export function resolveKeyterms(enabledIds: string[]): string[] {
  const active = PACKS.filter((p) => p.base || enabledIds.includes(p.id))
  const seen = new Set<string>()
  const out: string[] = []
  for (const pack of active) {
    for (const term of pack.terms) {
      const key = term.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        out.push(term)
      }
    }
  }
  return out.slice(0, KEYTERM_CAP)
}
