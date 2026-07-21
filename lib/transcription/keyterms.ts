// Curated ASR keyterm vocabulary. Sent ONCE at connect (no per-word latency),
// but bounded by provider caps: AssemblyAI = 100 terms, Deepgram = 100 terms /
// 500-token budget. So this is deliberately CURATED, not exhaustive — only the
// terms that are acronym-heavy, brand-like, or phonetically risky (the ones ASR
// actually mangles). Boosting everything dilutes the boost; a focused set lifts
// accuracy far more than dumping a whole glossary.
//
// Source: deep-research-report — Amazon SDE II streaming keyterm catalog, filtered
// to High-priority + high-ASR-fragility terms. Keep additions to genuinely-misheard
// jargon; drop common words the model already gets right.
export const KEYTERMS: string[] = [
  // Cloud / AWS (brand-like, often normalized wrong)
  'AWS Lambda', 'Amazon ECS', 'Amazon EC2', 'Amazon S3', 'DynamoDB', 'CloudWatch', 'AWS IAM',
  'Apache Kafka', 'Apache Spark', 'Redis',
  // Distributed systems (fragile multi-word / homophone-prone)
  'idempotency', 'partitioning', 'sharding', 'consistent hashing', 'quorum', 'replication',
  'backpressure', 'circuit breaker', 'jittered exponential backoff', 'fan-out', 'load shedding',
  'low-latency', 'fault tolerance', 'event-driven architecture', 'control plane', 'data plane',
  // Algorithms / coding
  'Big O', 'HashMap', 'HashSet', 'two pointers', 'sliding window', 'BFS', 'DFS',
  'binary search', 'topological sort', 'dynamic programming', 'backtracking',
  // Languages / frameworks
  'Kubernetes', 'Spring Boot', 'Rust', 'quantization',
  // DevOps / observability (acronyms)
  'CI/CD', 'Docker', 'GitHub Actions', 'observability', 'MTTR', 'P99', 'canary deployment',
  // AI / ML / LLM
  'RAG', 'embeddings', 'vector database', 'FAISS', 'LangChain', 'few-shot prompting',
  'structured output', 'fine-tuning',
  // Networking / real-time media (acronym-dense, highly ASR-fragile)
  'WebRTC', 'SFU', 'STUN', 'TURN', 'ICE', 'SDP', 'DTLS-SRTP', 'RTP', 'RTCP',
  // Amazon interview vocabulary
  'Bar Raiser', 'Leadership Principles', 'operational excellence',
]
