/** Immediate, local scaffolding while an answer is pending or unavailable.
 * These are labelled starting cues, not generated answers or observed findings. */
export function speakingCue(question: string): string {
  if (/\b(?:this|that|there|it)\b/i.test(question) && question.split(/\s+/).length < 8 && !/\b(?:synchronous|asynchronous|thread|timeout|retry|error|fail|concurr)/i.test(question)) return '“Which part do you mean—the proposed approach or the code currently on screen?”'
  if (/\b(?:error|fail\w*|exception|catch|retr\w*)\b/i.test(question)) return '“I’d trace where the failure happens, how the caller learns about it, and what state remains. Then I’d decide what can safely be retried.”'
  if (/\b(?:concurr\w*|parallel|threads?|load|scale|scaling)\b/i.test(question)) return '“I’d check the work limit, shared state, and overload behavior, then walk through two requests arriving together.”'
  if (/\b(?:timeout|deadline|slow|latency|performance)\b/i.test(question)) return '“I’d separate the client’s response deadline from the time the required work takes, then check what the response must contain.”'
  if (/\b(?:test|verify|verification)\b/i.test(question)) return '“I’d define the expected behavior, check the success and failure paths, and include a boundary case before calling the change verified.”'
  if (/\b(?:implement|change|fix|refactor|write|code)\b/i.test(question)) return '“I’d pin down the behavior we need to preserve, identify the smallest change, and walk through how we’ll verify it.”'
  return '“I’ll start with the core behavior, explain why it works, and then cover the tradeoff that matters for this question.”'
}
