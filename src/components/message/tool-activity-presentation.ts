import type { AdaptedToolCallPart } from "@/lib/adapters/ai-elements-adapter"
import {
  CODEX_SCRIPT_TOOL_NAME,
  parseCodexScriptCard,
} from "@/lib/codex-code-mode"
import { normalizeToolName } from "@/lib/tool-call-normalization"
import {
  describeStdinChars,
  extractAnnouncedSessionId,
  isShellSessionToolName,
  parseShellSessionInput,
  WAIT_TOOL_NAME,
} from "@/lib/shell-session-tool"

export type ToolActivityKind =
  | "command"
  | "script"
  | "session"
  | "read"
  | "edit"
  | "write"
  | "search"
  | "web"
  | "todo"
  | "task"
  | "tool"

export type ToolActivityPresentation = {
  kind: ToolActivityKind
  /** The concrete thing the agent touched: a command, path, query, or URL. */
  subject: string | null
  /** Supporting context that stays secondary to the concrete target. */
  context: string | null
  /** The normalized shell source when this is an executable command. */
  command: string | null
  /** File targets recovered from standard arguments or a unified patch. */
  paths: string[]
  monospace: boolean
}

type JsonRecord = Record<string, unknown>

function asRecord(input: string | null | undefined): JsonRecord | null {
  if (!input) return null
  try {
    const value: unknown = JSON.parse(input)
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : null
  } catch {
    return null
  }
}

function findString(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | null {
  if (depth > 4 || !value || typeof value !== "object") return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys, depth + 1)
      if (found) return found
    }
    return null
  }

  const record = value as JsonRecord
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim()
    }
  }

  for (const child of Object.values(record)) {
    const found = findString(child, keys, depth + 1)
    if (found) return found
  }
  return null
}

function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  return parts.slice(-2).join("/") || normalized
}

function ellipsis(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function unwrapQuotedCommand(command: string): string {
  const trimmed = command.trim()
  if (trimmed.length < 2) return trimmed
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\")
  }
  return trimmed
}

/** Remove the boilerplate shell wrapper agents often use around a real command. */
export function simplifyToolCommand(command: string): string {
  let current = command.trim()
  const wrapper =
    /^(?:\/usr\/bin\/env\s+)?(?:(?:\/[^\s]+\/)?(?:bash|zsh|sh))\s+-(?:l?c)\s+(.+)$/i

  for (let index = 0; index < 6; index += 1) {
    const match = current.match(wrapper)
    if (!match) break
    const next = unwrapQuotedCommand(match[1] ?? "").trim()
    if (!next || next === current) break
    current = next
  }

  return current
}

function commandFromInput(input: string | null | undefined): string | null {
  const parsed = asRecord(input)
  const direct = parsed
    ? findString(parsed, [
        "command",
        "cmd",
        "script",
        // Antigravity uses snake_case on the live call and PascalCase in its
        // stored trajectory / permission envelope. Its display title is also
        // the command, but the input is the stable source used by our grouped
        // activity flow.
        "command_line",
        "CommandLine",
        "title",
      ])
    : null
  if (direct) return simplifyToolCommand(direct)

  if (!input || input.trim().startsWith("{")) return null
  return simplifyToolCommand(input)
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    const normalized = path.trim().replace(/^\.\//, "")
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function patchPaths(source: string | null | undefined): string[] {
  if (!source) return []
  const paths: string[] = []
  const patchFile = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/gm
  const diffFile = /^diff --git a\/(.+?) b\/(.+)$/gm

  for (const match of source.matchAll(patchFile)) {
    if (match[1]) paths.push(match[1])
  }
  for (const match of source.matchAll(diffFile)) {
    if (match[2] && match[2] !== "/dev/null") paths.push(match[2])
    else if (match[1] && match[1] !== "/dev/null") paths.push(match[1])
  }
  return uniquePaths(paths)
}

/**
 * Recover a string field before a live JSON payload is complete. File edits
 * commonly stream the large replacement text last, so waiting for JSON.parse
 * would briefly erase the target file from the activity row.
 */
function rawJsonStringField(
  input: string | null | undefined,
  keys: readonly string[]
): string | null {
  if (!input) return null

  for (const key of keys) {
    const match = input.match(
      new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)
    )
    const rawValue = match?.[1]
    if (!rawValue) continue

    try {
      const decoded: unknown = JSON.parse(`"${rawValue}"`)
      if (typeof decoded === "string" && decoded.trim()) return decoded.trim()
    } catch {
      // Keep the readable prefix when a malformed escape sequence is still
      // being streamed; the complete payload will replace it on the next frame.
      return rawValue.trim() || null
    }
  }

  return null
}

function pathsFromInput(input: string | null | undefined): string[] {
  const parsed = asRecord(input)
  const paths: string[] = []
  const direct = parsed
    ? findString(parsed, [
        "file_path",
        "filePath",
        "target_file",
        "targetFile",
        "filename",
        "notebook_path",
        "path",
      ])
    : null
  const rawDirect = rawJsonStringField(input, [
    "file_path",
    "filePath",
    "target_file",
    "targetFile",
    "filename",
    "notebook_path",
    "path",
  ])
  if (direct ?? rawDirect) paths.push(direct ?? rawDirect ?? "")

  if (parsed && typeof parsed.changes === "object" && parsed.changes) {
    paths.push(...Object.keys(parsed.changes as JsonRecord))
  }
  const embeddedPatch = parsed ? findString(parsed, ["patch", "diff"]) : null
  return uniquePaths([
    ...paths,
    ...patchPaths(input),
    ...patchPaths(embeddedPatch),
  ])
}

function titleForPaths(paths: readonly string[]): string | null {
  if (paths.length === 0) return null
  if (paths.length === 1) return shortPath(paths[0] ?? "")
  return `${shortPath(paths[0] ?? "")} +${paths.length - 1}`
}

function contextFromPath(path: string | null): string | null {
  if (!path) return null
  const normalized = path.replace(/\\/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  return parts.length > 2 ? parts.slice(0, -2).join("/") : null
}

function activityTitleFallback(
  title: string | null | undefined
): string | null {
  const trimmed = title?.trim()
  if (!trimmed) return null

  // Some adapters emit a wrapper such as `my_tool call`; keep the actual
  // function name rather than repeating adapter terminology in the timeline.
  const callName = trimmed.match(
    /^[:：'"`“”‘’\s]*([a-z0-9_.-]+)(?:\s*[:：])?\s*call[\w-]*['"`“”‘’\s]*$/i
  )
  const candidate = callName?.[1] ?? trimmed

  // `MCP: tool` is an adapter placeholder, not a name a reader can act on.
  // Do not replace a meaningful input-derived subject with it.
  if (/^(?:mcp:\s*)?tool$/i.test(candidate)) return null

  return ellipsis(candidate, 88)
}

function genericSubject(input: string | null): string | null {
  const parsed = asRecord(input)
  const subject = parsed
    ? findString(parsed, [
        "description",
        "query",
        "prompt",
        "subject",
        "name",
        "title",
      ])
    : null
  // Tool names such as "TodoWrite" do not help someone scan the timeline;
  // use only a concrete title or target extracted from its arguments.
  return subject ? ellipsis(subject, 84) : null
}

/**
 * Recover the concrete subject of a tool call before it reaches the UI. This
 * keeps activity rows useful even though their input shape differs across ACP
 * hosts (Codex, Claude Code, Cline, and OpenCode).
 */
export function describeToolActivity(
  part: Pick<
    AdaptedToolCallPart,
    "toolName" | "input" | "displayTitle" | "output" | "errorText"
  >
): ToolActivityPresentation {
  const name = normalizeToolName(part.toolName).toLowerCase()
  const parsed = asRecord(part.input)
  const paths = pathsFromInput(part.input)
  const command = commandFromInput(part.input)
  const displayTitle = activityTitleFallback(part.displayTitle)
  const inputSubject = genericSubject(part.input)
  const genericSubjectWithTitle = displayTitle ?? inputSubject
  const genericContext =
    displayTitle && inputSubject && inputSubject !== displayTitle
      ? inputSubject
      : null

  if (name === CODEX_SCRIPT_TOOL_NAME) {
    const script = parseCodexScriptCard(part.input)
    return {
      kind: "script",
      subject: script?.title ? ellipsis(script.title, 88) : null,
      context: null,
      command: null,
      paths: [],
      monospace: Boolean(script?.title),
    }
  }

  if (name === "bash" || name === "exec_command") {
    const description = parsed ? findString(parsed, ["description"]) : null
    const announcedSessionId =
      name === "exec_command"
        ? extractAnnouncedSessionId(part.output ?? part.errorText)
        : null
    return {
      kind: "command",
      subject: command
        ? ellipsis(command.split("\n")[0] ?? command, 88)
        : (description ?? displayTitle),
      context:
        announcedSessionId && command
          ? `Session ${announcedSessionId}`
          : command && description
            ? ellipsis(description, 64)
            : null,
      command,
      paths: [],
      monospace: Boolean(command),
    }
  }

  if (isShellSessionToolName(name)) {
    const session = parseShellSessionInput(part.input)
    const sessionCommand = session?.command
      ? simplifyToolCommand(session.command)
      : null
    const commandSubject = sessionCommand
      ? ellipsis(sessionCommand.split("\n")[0] ?? "", 88)
      : null
    const isStdin = Boolean(session?.chars)
    const verb =
      name === WAIT_TOOL_NAME && session?.terminate ? "Terminate" : "Wait"
    const subject = isStdin
      ? `Stdin ${describeStdinChars(session?.chars ?? "")}`
      : commandSubject
        ? `${verb} ${commandSubject}`
        : session?.sessionId
          ? `${verb} cell ${session.sessionId}`
          : displayTitle
    return {
      kind: "session",
      subject,
      context: isStdin ? commandSubject : null,
      command: sessionCommand,
      paths: [],
      monospace: Boolean(subject),
    }
  }

  if (
    name === "read" ||
    name === "read file" ||
    name === "read_file" ||
    name === "view"
  ) {
    const path = paths[0] ?? null
    return {
      kind: "read",
      subject: path ? shortPath(path) : displayTitle,
      context: contextFromPath(path),
      command: null,
      paths,
      monospace: Boolean(path),
    }
  }

  if (name === "edit" || name === "apply_patch" || name === "str_replace") {
    const allPaths = uniquePaths([...paths, ...patchPaths(part.input)])
    return {
      kind: "edit",
      subject: titleForPaths(allPaths) ?? displayTitle,
      context:
        allPaths.length === 1 ? contextFromPath(allPaths[0] ?? null) : null,
      command: null,
      paths: allPaths,
      monospace: allPaths.length > 0,
    }
  }

  if (
    name === "write" ||
    name === "notebookedit" ||
    name === "create_file" ||
    name === "write_to_file" ||
    name === "replace_in_file"
  ) {
    const path = paths[0] ?? null
    return {
      kind: "write",
      subject: path ? shortPath(path) : displayTitle,
      context: contextFromPath(path),
      command: null,
      paths,
      monospace: Boolean(path),
    }
  }

  if (
    name === "grep" ||
    name === "glob" ||
    name === "search" ||
    name === "find" ||
    name === "list_files" ||
    name === "list_code_definition_names"
  ) {
    const query = parsed
      ? findString(parsed, ["pattern", "query", "glob"])
      : null
    const scope = parsed ? findString(parsed, ["path"]) : null
    return {
      kind: "search",
      subject: query
        ? ellipsis(query, 88)
        : scope
          ? shortPath(scope)
          : displayTitle,
      context: query && scope ? ellipsis(scope, 56) : null,
      command: null,
      paths: [],
      monospace: Boolean(query || scope),
    }
  }

  if (
    name === "webfetch" ||
    name === "websearch" ||
    name === "fetch" ||
    name === "browser" ||
    name === "browser_action" ||
    name === "web_search"
  ) {
    const target = parsed ? findString(parsed, ["url", "query"]) : null
    return {
      kind: "web",
      subject: target ? ellipsis(target, 88) : displayTitle,
      context: null,
      command: null,
      paths: [],
      monospace: Boolean(target?.startsWith("http")),
    }
  }

  if (
    name === "todowrite" ||
    name === "tasklist" ||
    name === "taskcreate" ||
    name === "taskupdate" ||
    name === "update_todo_list"
  ) {
    return {
      kind: "todo",
      subject: genericSubjectWithTitle,
      context: genericContext,
      command: null,
      paths: [],
      monospace: false,
    }
  }

  if (name === "task" || name === "skill" || name === "new_task") {
    return {
      kind: "task",
      subject: genericSubjectWithTitle,
      context: genericContext,
      command: null,
      paths: [],
      monospace: false,
    }
  }

  return {
    kind: "tool",
    subject: genericSubjectWithTitle,
    context: genericContext,
    command: null,
    paths,
    monospace: false,
  }
}
