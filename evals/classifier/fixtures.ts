import type { Classification } from '../../lib/copilot/classification'

export type ExpectedClassification = Pick<Classification, 'mode' | 'isQuestion' | 'needsWeb'>
export type ClassifierFixture = {
  id: string
  category: 'strong' | 'ambiguous' | 'chatter' | 'repo-coding' | 'repo-design' | 'current-facts'
  utterance: string
  expected: ExpectedClassification
  rationale: string
}

// Hand-labeled utterances, not labels copied from either classifier. Category is
// semantic; the production local classifier determines whether a network call runs.
export const classifierFixtures: ClassifierFixture[] = [
  { id: 'strong-algorithm', category: 'strong', utterance: 'Reverse a linked list in place and explain the time complexity.', expected: { mode: 'coding', isQuestion: true, needsWeb: false }, rationale: 'Standalone algorithm request.' },
  { id: 'strong-behavioral', category: 'strong', utterance: 'Tell me about a time you recently mentored a teammate.', expected: { mode: 'behavioral', isQuestion: true, needsWeb: false }, rationale: 'Personal experience; recently does not require external facts.' },
  { id: 'strong-design', category: 'strong', utterance: 'Design a URL shortener for a million users.', expected: { mode: 'systemDesign', isQuestion: true, needsWeb: false }, rationale: 'New system design with no repository or current external facts.' },
  { id: 'strong-repository', category: 'strong', utterance: 'Which file handles cancellation in this repo?', expected: { mode: 'repoInterview', isQuestion: true, needsWeb: false }, rationale: 'Locate an implementation in an existing repository.' },
  { id: 'strong-general', category: 'strong', utterance: 'What is the difference between TCP and UDP?', expected: { mode: 'general', isQuestion: true, needsWeb: false }, rationale: 'Timeless factual question, not an implementation or design task.' },
  { id: 'ambiguous-personal-conflict', category: 'ambiguous', utterance: 'Explain how you handled a conflict with your tech lead.', expected: { mode: 'behavioral', isQuestion: true, needsWeb: false }, rationale: 'Personal conflict without the canonical behavioral stem.' },
  { id: 'ambiguous-technical-conflict', category: 'ambiguous', utterance: 'Compare a merge conflict with a runtime failure.', expected: { mode: 'general', isQuestion: true, needsWeb: false }, rationale: 'Technical terminology, not a personal experience or an existing repository.' },
  { id: 'ambiguous-feedback', category: 'ambiguous', utterance: 'How did you give feedback after your last incident?', expected: { mode: 'behavioral', isQuestion: true, needsWeb: false }, rationale: 'Asks about the candidate\'s actual behavior.' },
  { id: 'ambiguous-sort-imperative', category: 'ambiguous', utterance: 'Sort the numbers in ascending order and discuss alternatives.', expected: { mode: 'coding', isQuestion: true, needsWeb: false }, rationale: 'An imperative algorithm request still counts as a question.' },
  { id: 'ambiguous-repo-imperative', category: 'ambiguous', utterance: 'Fix the cancellation bug in packages/orders/service.ts.', expected: { mode: 'repoInterview', isQuestion: true, needsWeb: false }, rationale: 'An explicit existing source path makes this repository work.' },
  { id: 'chatter-thanks', category: 'chatter', utterance: 'Thanks, that makes sense.', expected: { mode: 'general', isQuestion: false, needsWeb: false }, rationale: 'Acknowledgment, not a request.' },
  { id: 'chatter-thinking', category: 'chatter', utterance: 'Let me think for a moment.', expected: { mode: 'general', isQuestion: false, needsWeb: false }, rationale: 'Candidate filler, not a request for help.' },
  { id: 'chatter-algorithm-answer', category: 'chatter', utterance: 'I implemented a function to reverse a linked list.', expected: { mode: 'coding', isQuestion: false, needsWeb: false }, rationale: 'The subject is coding, but the candidate is answering.' },
  { id: 'chatter-design-answer', category: 'chatter', utterance: 'Our architecture handled ten million requests.', expected: { mode: 'systemDesign', isQuestion: false, needsWeb: false }, rationale: 'The subject is architecture, but this is not a new question.' },
  { id: 'repo-coding-implementation', category: 'repo-coding', utterance: 'Implement a function in this repo that retries failed requests.', expected: { mode: 'repoInterview', isQuestion: true, needsWeb: false }, rationale: 'Existing repository context takes precedence over generic coding words.' },
  { id: 'repo-coding-debug', category: 'repo-coding', utterance: 'Debug this failing test in the repository and show the smallest patch.', expected: { mode: 'repoInterview', isQuestion: true, needsWeb: false }, rationale: 'Debug an existing test and implementation together.' },
  { id: 'repo-coding-complexity', category: 'repo-coding', utterance: 'What is the time complexity of the existing implementation in this repo?', expected: { mode: 'repoInterview', isQuestion: true, needsWeb: false }, rationale: 'The answer must inspect existing code, not substitute a generic algorithm.' },
  { id: 'repo-design-trace', category: 'repo-design', utterance: 'Explain the architecture in this repo and trace the request flow.', expected: { mode: 'repoInterview', isQuestion: true, needsWeb: false }, rationale: 'Repository architecture requires evidence from actual files.' },
  { id: 'repo-design-change', category: 'repo-design', utterance: 'Design a service using the existing implementation in this repo.', expected: { mode: 'repoInterview', isQuestion: true, needsWeb: false }, rationale: 'The change must fit existing implementation evidence.' },
  { id: 'repo-design-local-current', category: 'repo-design', utterance: 'How would you scale to a million users without changing the current architecture in this repo?', expected: { mode: 'repoInterview', isQuestion: true, needsWeb: false }, rationale: 'Current refers to repository-local architecture, not external facts.' },
  { id: 'current-node-version', category: 'current-facts', utterance: 'What is the latest stable Node.js version today?', expected: { mode: 'general', isQuestion: true, needsWeb: true }, rationale: 'A current external release number must be checked.' },
  { id: 'current-cloud-price', category: 'current-facts', utterance: 'Which AWS region has the lowest current Lambda price?', expected: { mode: 'general', isQuestion: true, needsWeb: true }, rationale: 'Current external pricing changes over time.' },
  { id: 'current-coding-api', category: 'current-facts', utterance: 'Write a function using the latest Node.js stable release API, and verify the current API signature online.', expected: { mode: 'coding', isQuestion: true, needsWeb: true }, rationale: 'Coding can also require current external API facts.' },
  { id: 'current-design-quota', category: 'current-facts', utterance: 'Design a system using the current AWS Lambda per-region concurrency quotas; check those quotas.', expected: { mode: 'systemDesign', isQuestion: true, needsWeb: true }, rationale: 'System design can depend on changing provider quotas.' },
  { id: 'current-repo-local-schema', category: 'current-facts', utterance: 'Which file uses the latest locally checked-in schema in this repo?', expected: { mode: 'repoInterview', isQuestion: true, needsWeb: false }, rationale: 'Latest refers to repository evidence, not a web fact.' },
]
