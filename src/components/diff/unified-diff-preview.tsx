"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FilePathLink } from "@/components/ai-elements/link-safety"

type RowMarker = "none" | "added" | "deleted" | "modified"
type DiffFileMode = "modified" | "added" | "deleted" | "renamed"

interface RawDiffRow {
  kind: "context" | "add" | "del"
  text: string
  oldLine: number | null
  newLine: number | null
}

interface ParsedDiffRow {
  type: "context" | "added" | "deleted" | "modified"
  text: string
  sign: " " | "+" | "-"
  oldLine: number | null
  newLine: number | null
}

interface ParsedDiffHunk {
  key: string
  oldStart: number | null
  oldCount: number | null
  newStart: number | null
  newCount: number | null
  rows: ParsedDiffRow[]
}

interface ParsedDiffFile {
  key: string
  path: string
  oldPath: string | null
  newPath: string | null
  mode: DiffFileMode
  additions: number
  deletions: number
  hunks: ParsedDiffHunk[]
}

interface WorkingHunk {
  key: string
  oldStart: number | null
  oldCount: number | null
  newStart: number | null
  newCount: number | null
  rows: RawDiffRow[]
}

interface WorkingFile {
  key: string
  path: string
  oldPath: string | null
  newPath: string | null
  mode: DiffFileMode
  additions: number
  deletions: number
  hunks: WorkingHunk[]
}

const ROW_CLASS: Record<RowMarker, string> = {
  none: "",
  added: "bg-green-500/10 text-green-900 dark:text-green-300",
  deleted: "bg-red-500/10 text-red-900 dark:text-red-300",
  modified: "bg-blue-500/10 text-blue-900 dark:text-blue-300",
}

const SIGN_CLASS: Record<string, string> = {
  "+": "text-green-700 dark:text-green-400",
  "-": "text-red-700 dark:text-red-400",
  " ": "text-muted-foreground/50",
}

function normalizePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^"|"$/g, "")
  if (!trimmed || trimmed === "/dev/null") return null
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2).replace(/\\/g, "/")
  }
  return trimmed.replace(/\\/g, "/")
}

function parsePathFromDiffGitLine(line: string): string | null {
  const match = line.match(/^diff --git\s+(.+?)\s+(.+)$/)
  if (!match) return null
  return normalizePath(match[2]) ?? normalizePath(match[1])
}

function parseApplyPatchMarker(line: string): {
  path: string | null
  mode: DiffFileMode
} | null {
  if (line.startsWith("*** Update File: ")) {
    return {
      path: normalizePath(line.slice("*** Update File: ".length)),
      mode: "modified",
    }
  }
  if (line.startsWith("*** Add File: ")) {
    return {
      path: normalizePath(line.slice("*** Add File: ".length)),
      mode: "added",
    }
  }
  if (line.startsWith("*** Delete File: ")) {
    return {
      path: normalizePath(line.slice("*** Delete File: ".length)),
      mode: "deleted",
    }
  }
  return null
}

function parseHunkHeader(line: string): {
  oldStart: number | null
  oldCount: number | null
  newStart: number | null
  newCount: number | null
} | null {
  if (!line.startsWith("@@")) return null

  const match = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/)
  if (!match) {
    return {
      oldStart: null,
      oldCount: null,
      newStart: null,
      newCount: null,
    }
  }

  return {
    oldStart: Number(match[1]),
    oldCount: match[2] ? Number(match[2]) : 1,
    newStart: Number(match[3]),
    newCount: match[4] ? Number(match[4]) : 1,
  }
}

function classifyRows(rows: RawDiffRow[]): ParsedDiffRow[] {
  const parsed: ParsedDiffRow[] = []
  let index = 0

  while (index < rows.length) {
    const current = rows[index]
    if (!current) break

    if (current.kind === "context") {
      parsed.push({
        type: "context",
        text: current.text,
        sign: " ",
        oldLine: current.oldLine,
        newLine: current.newLine,
      })
      index += 1
      continue
    }

    if (current.kind === "add") {
      let addEnd = index
      while (addEnd < rows.length && rows[addEnd]?.kind === "add") {
        const row = rows[addEnd]
        if (!row) break
        parsed.push({
          type: "added",
          text: row.text,
          sign: "+",
          oldLine: row.oldLine,
          newLine: row.newLine,
        })
        addEnd += 1
      }
      index = addEnd
      continue
    }

    let delEnd = index
    while (delEnd < rows.length && rows[delEnd]?.kind === "del") {
      delEnd += 1
    }

    let addEnd = delEnd
    while (addEnd < rows.length && rows[addEnd]?.kind === "add") {
      addEnd += 1
    }

    for (let d = index; d < delEnd; d++) {
      const row = rows[d]
      if (!row) continue
      parsed.push({
        type: "deleted",
        text: row.text,
        sign: "-",
        oldLine: row.oldLine,
        newLine: row.newLine,
      })
    }

    for (let a = delEnd; a < addEnd; a++) {
      const row = rows[a]
      if (!row) continue
      parsed.push({
        type: "added",
        text: row.text,
        sign: "+",
        oldLine: row.oldLine,
        newLine: row.newLine,
      })
    }

    index = addEnd
  }

  return parsed
}

function resolveFileMode(file: WorkingFile): DiffFileMode {
  if (file.mode !== "modified") return file.mode
  if (file.oldPath && !file.newPath) return "deleted"
  if (!file.oldPath && file.newPath) return "added"
  if (file.oldPath && file.newPath && file.oldPath !== file.newPath) {
    return "renamed"
  }
  return "modified"
}

function parseUnifiedDiff(diffText: string): ParsedDiffFile[] {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n")
  const files: WorkingFile[] = []

  let fileIndex = 1
  let hunkIndex = 1
  let currentFile: WorkingFile | null = null
  let currentHunk: WorkingHunk | null = null
  let oldLineCursor: number | null = null
  let newLineCursor: number | null = null
  let inferredOldCursorForNextHunk = 1
  let inferredNewCursorForNextHunk = 1

  const getActiveFile = (): WorkingFile | null =>
    currentFile ?? files[files.length - 1] ?? null
  const getActiveHunk = (): WorkingHunk | null => currentHunk
  const getOldLineCursor = (): number | null => oldLineCursor
  const getNewLineCursor = (): number | null => newLineCursor

  const flushHunk = () => {
    const file = getActiveFile()
    if (!file || !currentHunk) return
    file.hunks.push(currentHunk)
    if (oldLineCursor !== null) {
      inferredOldCursorForNextHunk = Math.max(1, oldLineCursor)
    }
    if (newLineCursor !== null) {
      inferredNewCursorForNextHunk = Math.max(1, newLineCursor)
    }
    currentHunk = null
  }

  const startFile = (
    path: string | null,
    mode: DiffFileMode = "modified"
  ): WorkingFile => {
    flushHunk()
    currentFile = {
      key: `file-${fileIndex}`,
      path: path ?? `Diff #${fileIndex}`,
      oldPath: null,
      newPath: null,
      mode,
      additions: 0,
      deletions: 0,
      hunks: [],
    }
    files.push(currentFile)
    fileIndex += 1
    inferredOldCursorForNextHunk = 1
    inferredNewCursorForNextHunk = 1
    return currentFile
  }

  const ensureFile = () => getActiveFile() ?? startFile(null)

  const startHunk = (line: string) => {
    const file = ensureFile()
    flushHunk()

    const parsed = parseHunkHeader(line)
    const resolvedOldStart = parsed?.oldStart ?? inferredOldCursorForNextHunk
    const resolvedNewStart = parsed?.newStart ?? inferredNewCursorForNextHunk
    oldLineCursor = resolvedOldStart
    newLineCursor = resolvedNewStart

    currentHunk = {
      key: `${file.key}:hunk-${hunkIndex}`,
      oldStart: resolvedOldStart,
      oldCount: parsed?.oldCount ?? null,
      newStart: resolvedNewStart,
      newCount: parsed?.newCount ?? null,
      rows: [],
    }
    hunkIndex += 1
  }

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      startFile(parsePathFromDiffGitLine(line))
      continue
    }

    const applyPatchMarker = parseApplyPatchMarker(line)
    if (applyPatchMarker) {
      startFile(applyPatchMarker.path, applyPatchMarker.mode)
      continue
    }

    if (line.startsWith("*** Move to: ")) {
      const movedPath = normalizePath(line.slice("*** Move to: ".length))
      const file = getActiveFile()
      if (file && movedPath) {
        file.newPath = movedPath
        file.path = movedPath
        file.mode = "renamed"
      }
      continue
    }

    if (line.startsWith("--- ")) {
      const file = ensureFile()
      const oldPath = normalizePath(line.slice(4))
      file.oldPath = oldPath
      if (!file.newPath && oldPath) file.path = oldPath
      continue
    }

    if (line.startsWith("+++ ")) {
      const file = ensureFile()
      const newPath = normalizePath(line.slice(4))
      file.newPath = newPath
      if (newPath) file.path = newPath
      continue
    }

    if (line.startsWith("@@")) {
      startHunk(line)
      continue
    }

    let hunk = getActiveHunk()
    // Auto-create an implicit hunk for patch formats (e.g. *** Add File)
    // that emit +/- lines without a preceding @@ header.
    if (
      !hunk &&
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
    ) {
      if (getActiveFile()) {
        startHunk("@@")
        hunk = getActiveHunk()
      }
    }
    if (!hunk) continue

    if (line.startsWith("+") && !line.startsWith("+++")) {
      hunk.rows.push({
        kind: "add",
        text: line.slice(1),
        oldLine: null,
        newLine: newLineCursor,
      })
      const cursor = getNewLineCursor()
      if (cursor !== null) newLineCursor = cursor + 1
      const file = getActiveFile()
      if (file) file.additions += 1
      continue
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      hunk.rows.push({
        kind: "del",
        text: line.slice(1),
        oldLine: oldLineCursor,
        newLine: null,
      })
      const cursor = getOldLineCursor()
      if (cursor !== null) oldLineCursor = cursor + 1
      const file = getActiveFile()
      if (file) file.deletions += 1
      continue
    }

    if (line.startsWith(" ")) {
      hunk.rows.push({
        kind: "context",
        text: line.slice(1),
        oldLine: oldLineCursor,
        newLine: newLineCursor,
      })
      const nextOldCursor = getOldLineCursor()
      if (nextOldCursor !== null) oldLineCursor = nextOldCursor + 1
      const nextNewCursor = getNewLineCursor()
      if (nextNewCursor !== null) newLineCursor = nextNewCursor + 1
    }
  }

  flushHunk()

  return files
    .map((file) => ({
      ...file,
      mode: resolveFileMode(file),
      hunks: file.hunks
        .filter((hunk) => hunk.rows.length > 0)
        .map((hunk) => ({
          key: hunk.key,
          oldStart: hunk.oldStart,
          oldCount: hunk.oldCount,
          newStart: hunk.newStart,
          newCount: hunk.newCount,
          rows: classifyRows(hunk.rows),
        })),
    }))
    .filter((file) => file.hunks.length > 0)
}

function modeKey(
  mode: DiffFileMode
): "mode.added" | "mode.deleted" | "mode.renamed" | "mode.modified" {
  if (mode === "added") return "mode.added"
  if (mode === "deleted") return "mode.deleted"
  if (mode === "renamed") return "mode.renamed"
  return "mode.modified"
}

function toDisplayPath(filePath: string, folderPath: string | null): string {
  const normalizedPath = filePath.replace(/\\/g, "/")
  if (!folderPath) return normalizedPath

  const normalizedFolder = folderPath.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalizedFolder) return normalizedPath

  const prefix = `${normalizedFolder}/`
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length)
  }

  return normalizedPath
}

function rowMarker(row: ParsedDiffRow): RowMarker {
  if (row.type === "added") return "added"
  if (row.type === "deleted") return "deleted"
  return "none"
}

function HunkSeparator({ hunk }: { hunk: ParsedDiffHunk }) {
  const label =
    hunk.oldStart != null && hunk.oldCount != null
      ? `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart ?? hunk.oldStart},${hunk.newCount ?? hunk.oldCount} @@`
      : "···"
  return (
    <div className="flex items-center gap-2 border-y border-border/50 bg-muted/30 px-3 py-0.5 font-mono text-[11px] text-muted-foreground/60">
      <span className="select-none">{label}</span>
    </div>
  )
}

function HunkLines({ rows }: { rows: ParsedDiffRow[] }) {
  return (
    <div className="font-mono text-[12px] leading-[20px]">
      {rows.map((row, i) => {
        const marker = rowMarker(row)
        return (
          <div key={i} className={cn("flex", ROW_CLASS[marker])}>
            <span className="w-[3.5rem] shrink-0 select-none pr-1 text-right text-muted-foreground/40">
              {row.oldLine ?? ""}
            </span>
            <span className="w-[3.5rem] shrink-0 select-none pr-1 text-right text-muted-foreground/40">
              {row.newLine ?? ""}
            </span>
            <span
              className={cn(
                "w-4 shrink-0 select-none text-center",
                SIGN_CLASS[row.sign] ?? ""
              )}
            >
              {row.sign === " " ? "" : row.sign}
            </span>
            <span className="flex-1 whitespace-pre pr-3">{row.text}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Clean file content view for new files (no diff signs, green highlight as added) */
function NewFileLines({ rows }: { rows: ParsedDiffRow[] }) {
  return (
    <div className="font-mono text-[12px] leading-[20px]">
      {rows.map((row, i) => (
        <div key={i} className={cn("flex", ROW_CLASS.added)}>
          <span className="w-[3.5rem] shrink-0 select-none pr-1 text-right text-muted-foreground/40">
            {row.newLine ?? i + 1}
          </span>
          <span className="flex-1 whitespace-pre pr-3">{row.text}</span>
        </div>
      ))}
    </div>
  )
}

function isNewFileOnly(file: ParsedDiffFile): boolean {
  return file.mode === "added" && file.deletions === 0
}

// Beyond this many rows a single file is rendered as a bounded preview: each
// diff row is its own DOM node (line-number gutters + sign + text), so a
// lockfile or bulk-refactor diff of 5k–20k lines would otherwise build tens of
// thousands of nodes synchronously and freeze the UI for seconds — all just to
// be clipped inside the 420px-tall scroll box. The remainder is one click away.
const MAX_PREVIEW_ROWS = 500

/**
 * Take at most `limit` rows across the file's hunks in order, slicing the hunk
 * that crosses the budget so the preview ends on a clean row. Callers only use
 * this when the file's total row count exceeds `limit`.
 */
function capHunks(hunks: ParsedDiffHunk[], limit: number): ParsedDiffHunk[] {
  const out: ParsedDiffHunk[] = []
  let budget = limit
  for (const hunk of hunks) {
    if (budget <= 0) break
    if (hunk.rows.length <= budget) {
      out.push(hunk)
      budget -= hunk.rows.length
    } else {
      out.push({ ...hunk, rows: hunk.rows.slice(0, budget) })
      budget = 0
    }
  }
  return out
}

function DiffFileSection({
  file,
  embedded,
  clickableFilePath,
  folderPath,
  unbounded,
}: {
  file: ParsedDiffFile
  embedded: boolean
  clickableFilePath: boolean
  folderPath: string | null
  unbounded: boolean
}) {
  const t = useTranslations("Folder.diffPreview")
  const [expanded, setExpanded] = useState(false)

  // Reset the reveal when a new diff reparses to a fresh `file` object at this
  // position: sections are keyed positionally (`file-1`, …), so React reuses
  // this instance across a `diffText` change. `file` is referentially stable
  // while `diffText` is unchanged (it comes from a `useMemo`), so this only
  // fires on a real content change. Resetting during render — not in an effect —
  // guarantees the incoming file is never committed in the previous file's
  // expanded (un-capped) state, which would resurface the exact multi-second
  // freeze the cap exists to prevent (React discards this render without
  // reconciling its children, then re-renders capped).
  const [renderedFile, setRenderedFile] = useState(file)
  if (file !== renderedFile) {
    setRenderedFile(file)
    setExpanded(false)
  }

  const newFile = isNewFileOnly(file)

  const totalRows = useMemo(
    () => file.hunks.reduce((sum, hunk) => sum + hunk.rows.length, 0),
    [file.hunks]
  )
  // A large file is capped until the user opts to render the rest. Small files
  // (the common case) keep rendering exactly as before.
  const capped = !expanded && totalRows > MAX_PREVIEW_ROWS
  const hunks = useMemo(
    () => (capped ? capHunks(file.hunks, MAX_PREVIEW_ROWS) : file.hunks),
    [capped, file.hunks]
  )

  return (
    <section
      className={cn(
        "flex flex-col",
        // Self-capped by default: the section owns a scroll box so a huge file
        // can't stretch its host. Embedded previews have one shared outer
        // viewport instead, so file sections stay part of the same content
        // flow rather than becoming a stack of scrollable cards.
        unbounded ? "min-h-0" : "max-h-[420px]",
        embedded
          ? "bg-transparent py-3 first:pt-0 last:pb-0"
          : "rounded-lg border border-border bg-background"
      )}
    >
      {embedded ? (
        <header className="flex shrink-0 items-center gap-2 border-b border-border/50 px-1 py-1.5 text-[11px]">
          {clickableFilePath ? (
            <FilePathLink
              filePath={file.path}
              className="min-w-0 flex-1 truncate font-mono font-medium text-foreground/80 hover:text-foreground"
              title={file.path}
            >
              {toDisplayPath(file.path, folderPath)}
            </FilePathLink>
          ) : (
            <span
              className="min-w-0 flex-1 truncate font-mono font-medium text-foreground/80"
              title={file.path}
            >
              {toDisplayPath(file.path, folderPath)}
            </span>
          )}
          {!newFile && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-2 font-mono">
              <span className="text-green-700 dark:text-green-400">
                +{file.additions}
              </span>
              <span className="text-red-700 dark:text-red-400">
                -{file.deletions}
              </span>
            </span>
          )}
        </header>
      ) : (
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px]">
          <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {newFile ? "WRITE" : t(modeKey(file.mode))}
          </span>
          {clickableFilePath ? (
            <FilePathLink
              filePath={file.path}
              className="min-w-0 flex-1 font-mono text-foreground"
              title={file.path}
            >
              {toDisplayPath(file.path, folderPath)}
            </FilePathLink>
          ) : (
            <span
              className="min-w-0 flex-1 truncate font-mono text-foreground"
              title={file.path}
            >
              {toDisplayPath(file.path, folderPath)}
            </span>
          )}
          {!newFile && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-2 font-mono">
              <span className="text-green-700 dark:text-green-400">
                +{file.additions}
              </span>
              <span className="text-red-700 dark:text-red-400">
                -{file.deletions}
              </span>
            </span>
          )}
        </header>
      )}

      <ScrollArea x="scroll" y={unbounded ? "hidden" : "scroll"}>
        <div className="inline-block min-w-full">
          {newFile
            ? hunks.map((hunk) => (
                <NewFileLines key={hunk.key} rows={hunk.rows} />
              ))
            : hunks.map((hunk, hunkIdx) => (
                <div key={hunk.key}>
                  {hunkIdx > 0 && <HunkSeparator hunk={hunk} />}
                  <HunkLines rows={hunk.rows} />
                </div>
              ))}
        </div>
      </ScrollArea>

      {capped && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            "shrink-0 select-none px-3 py-1 text-left font-mono text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            embedded ? "border-t border-border/50" : "border-t border-border"
          )}
        >
          {t("showRemainingLines", { count: totalRows - MAX_PREVIEW_ROWS })}
        </button>
      )}
    </section>
  )
}

export function UnifiedDiffPreview({
  diffText,
  className,
  clickableFilePath = false,
  embedded = false,
  unbounded = false,
  fill = false,
}: {
  diffText: string
  /** @deprecated No longer used — kept for API compat */
  modelId?: string
  className?: string
  /** When true, file-name header is clickable and opens the workspace open-file dialog. */
  clickableFilePath?: boolean
  /**
   * When true, render each file as part of one plain detail flow: no rounded
   * card or mode badge, only a lightweight file line directly above its diff.
   * This avoids double framing while keeping multi-file previews identifiable.
   */
  embedded?: boolean
  /**
   * Let each file's diff render at its natural height instead of inside its
   * own 420px scroll box. For hosts that cap and reveal the whole preview
   * themselves (the task diff dialog), which would otherwise nest a vertical
   * scroll inside another one.
   */
  unbounded?: boolean
  /**
   * Fill a host-controlled viewport rather than applying the compact preview
   * height used in message and dialog surfaces.
   */
  fill?: boolean
}) {
  const t = useTranslations("Folder.diffPreview")
  const { activeFolder: folder } = useActiveFolder()
  const files = useMemo(() => parseUnifiedDiff(diffText), [diffText])

  if (!diffText.trim()) {
    return (
      <div
        className={cn(
          "h-full flex items-center justify-center text-xs text-muted-foreground",
          className
        )}
      >
        {t("noDiffData")}
      </div>
    )
  }

  if (files.length === 0) {
    const pre = (
      <pre className="font-mono text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground p-3">
        {diffText}
      </pre>
    )
    return unbounded ? (
      <div className={className}>{pre}</div>
    ) : (
      <ScrollArea className={cn("h-full", className)} x="scroll">
        {pre}
      </ScrollArea>
    )
  }

  // Unbounded: the host sizes and scrolls the preview, so the outer viewport
  // is a plain box (each file still scrolls horizontally on its own).
  const Frame = unbounded ? UnboundedFrame : ScrollAreaFrame
  // A plain embedded preview is one continuous detail flow. Its outer viewport
  // owns vertical scrolling; individual files retain horizontal scrolling only.
  const fileContentUnbounded = unbounded || embedded

  return (
    <Frame
      className={cn(
        embedded && !unbounded && !fill && "max-h-[min(28rem,55vh)]",
        className
      )}
    >
      <div className={embedded ? "divide-y divide-border/50" : "space-y-3"}>
        {files.map((file) => (
          <DiffFileSection
            key={file.key}
            file={file}
            embedded={embedded}
            clickableFilePath={clickableFilePath}
            folderPath={folder?.path ?? null}
            unbounded={fileContentUnbounded}
          />
        ))}
      </div>
    </Frame>
  )
}

function ScrollAreaFrame({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <ScrollArea className={cn("h-full", className)} x="scroll">
      {children}
    </ScrollArea>
  )
}

function UnboundedFrame({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={className}>{children}</div>
}
