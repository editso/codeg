"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"

/**
 * Session ids already being rendered as nested sub-agent transcripts.
 *
 * Codex native sub-agents are forked rollouts. Their transcript can begin with
 * copied parent history, including the launch card that points straight back to
 * the rollout currently being rendered. Keeping the ancestry in context lets
 * the shared message renderer suppress that self-reference before it becomes
 * another nested transcript.
 */
const EMPTY_ANCESTRY: ReadonlySet<string> = new Set()

const SubagentTranscriptAncestryContext =
  createContext<ReadonlySet<string>>(EMPTY_ANCESTRY)

export function useSubagentTranscriptAncestry(): ReadonlySet<string> {
  return useContext(SubagentTranscriptAncestryContext)
}

export function SubagentTranscriptAncestryProvider({
  sessionId,
  children,
}: {
  sessionId: string
  children: ReactNode
}) {
  const parent = useSubagentTranscriptAncestry()
  const ancestry = useMemo(() => {
    const next = new Set(parent)
    next.add(sessionId)
    return next
  }, [parent, sessionId])

  return (
    <SubagentTranscriptAncestryContext.Provider value={ancestry}>
      {children}
    </SubagentTranscriptAncestryContext.Provider>
  )
}
