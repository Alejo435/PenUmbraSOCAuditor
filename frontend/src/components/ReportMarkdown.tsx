import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const PLUGINS = [remarkGfm]

const H2 = 'mt-8 mb-3 border-b pb-2 text-base font-semibold text-light-50'

// maps each markdown element onto the console's tokens. raw html in the markdown is never
// rendered, since report text includes values that came from log lines
const components: Components = {
  h1: ({ children }) => <h1 className="mb-3 text-xl font-semibold tracking-tight text-light-50">{children}</h1>,
  h2: ({ children }) => <h2 className={H2}>{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 mb-1 text-sm font-semibold text-light-100">{children}</h3>,
  p: ({ children }) => <p className="my-2 max-w-[75ch] text-sm leading-6 text-light-100">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-penumbra-400">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6 marker:text-penumbra-300">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-6 text-light-100">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-light-50">{children}</strong>,
  em: ({ children }) => {
    // the backend marks each node report's origin in italics, so origins render as small labels
    const fromAi = String(children).startsWith('AI report')
    return (
      <em
        className={cn(
          'inline-block rounded-sm px-1.5 py-0.5 text-xs not-italic',
          fromAi ? 'bg-haze-300/10 text-haze-300' : 'bg-umbra-700 text-penumbra-200',
        )}
      >
        {children}
      </em>
    )
  },
  code: ({ children }) => (
    <code className="rounded-sm bg-umbra-900 px-1 py-0.5 font-mono text-xs text-penumbra-200">{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b px-3 py-2 text-left text-xs font-medium text-penumbra-300 first:pl-0">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-umbra-700 px-3 py-2 align-top text-light-100 first:pl-0">{children}</td>
  ),
  hr: () => <hr className="my-6 border-umbra-600" />,
  a: ({ children, href }) => (
    <a href={href} className="text-light-50 underline underline-offset-2">
      {children}
    </a>
  ),
}

function Md({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={PLUGINS} components={components}>
      {text}
    </Markdown>
  )
}

// splits the markdown around one level-two section so that section can be styled on its own
function splitSection(markdown: string, title: string) {
  const start = markdown.indexOf(`## ${title}`)
  if (start === -1) return null
  const next = markdown.indexOf('\n## ', start + 3)
  const end = next === -1 ? markdown.length : next + 1
  return { before: markdown.slice(0, start), section: markdown.slice(start, end), after: markdown.slice(end) }
}

// renders the full report, drawing the executive summary as interpretation when gemma wrote it
export function ReportMarkdown({ markdown, aiSummary }: { markdown: string; aiSummary: boolean }) {
  const parts = splitSection(markdown, 'Executive summary')
  if (!parts) return <Md text={markdown} />

  // the section's first line is its heading, which is drawn separately above the rail
  const body = parts.section.slice(parts.section.indexOf('\n') + 1)

  return (
    <>
      <Md text={parts.before} />
      <h2 className={H2}>Executive summary</h2>
      <p className={cn('mb-2 text-xs font-medium', aiSummary ? 'text-haze-300' : 'text-penumbra-200')}>
        {aiSummary ? 'AI analysis' : 'Rule-based summary'}
      </p>
      <div
        className={cn(
          'border-l-2 pl-4',
          aiSummary ? 'border-dashed border-haze-300/60 [&_p]:text-haze-300' : 'border-penumbra-400/60',
        )}
      >
        <Md text={body} />
      </div>
      <Md text={parts.after} />
    </>
  )
}