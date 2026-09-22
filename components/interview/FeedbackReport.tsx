'use client'
import { RUBRIC, type InterviewFeedback, type InterviewTurn } from '@/lib/interview/model'

export function FeedbackReport({ report, turns }: { report: InterviewFeedback; turns: InterviewTurn[] }) {
  return (
    <section aria-labelledby="feedback-heading" className="space-y-6">
      <div className="reader-surface rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h2 id="feedback-heading" className="font-serif text-2xl">Interview feedback</h2>
          <p className="text-lg font-medium">{report.overall === null ? 'Not enough evidence to score' : `${report.overall} / 5`}<span className="block text-xs font-normal">AI coaching score · {report.dimensions.filter((d) => d.score !== null).length}/{report.dimensions.length} dimensions assessed</span><span className="block text-xs font-normal">Not a hiring prediction</span></p>
        </div>
        <p className="mt-4 whitespace-pre-wrap leading-relaxed">{report.overview}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {report.dimensions.map((d) => (
          <section key={d.key} className="reader-surface rounded-2xl p-5" aria-labelledby={`dimension-${d.key}`}>
            <h3 id={`dimension-${d.key}`} className="flex flex-wrap justify-between gap-3 font-medium">
              {RUBRIC[d.key]}<span>{d.score === null ? 'Not assessed' : `${d.score}/5`}</span>
            </h3>
            <p className="mt-3 text-sm leading-relaxed">{d.reason}</p>
            {d.evidence.map((e, index) => (
              <blockquote key={`${e.turnId}-${index}`} className="mt-3 border-l-2 border-[color:var(--signal)] pl-3 text-sm leading-relaxed">
                “{e.quote}” <a href={`#turn-${e.turnId}`} className="underline underline-offset-4">View answer</a>
              </blockquote>
            ))}
          </section>
        ))}
      </div>
      <section className="reader-surface rounded-2xl p-5 sm:p-6" aria-labelledby="question-feedback-heading">
        <h3 id="question-feedback-heading" className="font-serif text-xl">Question-by-question review</h3>
        {!report.questions.length && <p className="mt-3 text-sm">No interviewer questions were captured. The scorecard reviews candidate answers only.</p>}
        {report.questions.map((q, index) => (
          <details key={q.questionId} className="border-b border-current/10 py-3 last:border-0">
            <summary className="min-h-11 cursor-pointer py-2 font-medium">{index + 1}. {turns.find((t) => t.id === q.questionId)?.text} <span className="text-sm font-normal">· {q.score === null ? 'Not assessed' : `${q.score}/5`}</span></summary>
            <div className="space-y-4 pb-3 text-sm leading-relaxed">
              {q.strengths.length > 0 && <div><h4 className="font-medium">What worked</h4><ul className="list-disc space-y-1 pl-5">{q.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              {q.improvements.length > 0 && <div><h4 className="font-medium">Improve next time</h4><ul className="list-disc space-y-1 pl-5">{q.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              {q.answerOutline.length > 0 && <div><h4 className="font-medium">Practice outline — supply your own facts</h4><ol className="list-decimal space-y-1 pl-5">{q.answerOutline.map((s, i) => <li key={i}>{s}</li>)}</ol></div>}
              {q.evidence.map((e, i) => <p key={i}>Evidence: “{e.quote}” <a className="underline underline-offset-4" href={`#turn-${e.turnId}`}>View answer</a></p>)}
            </div>
          </details>
        ))}
      </section>
      <section className="reader-surface rounded-2xl p-5 sm:p-6" aria-labelledby="practice-heading">
        <h3 id="practice-heading" className="font-serif text-xl">Your next practice steps</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5">{report.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <h4 className="mt-6 font-medium">What this report cannot tell you</h4>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{report.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul>
      </section>
    </section>
  )
}
