"use client"

import dynamic from "next/dynamic"
import { useMonaco } from "@monaco-editor/react"
import type { editor as MonacoEditorNs } from "monaco-editor"
import type { BundledLanguage } from "shiki"
import { useMemo } from "react"
import {
  defineMonacoThemes,
  MONACO_UNICODE_HIGHLIGHT_OPTIONS,
  useMonacoWorkspaceTheme,
} from "@/lib/monaco-themes"
import { useEditorFont, useZoomLevel } from "@/hooks/use-appearance"

import "@/lib/monaco-local"

// This module is only mounted for large tool output. Loading the editor itself
// dynamically keeps Monaco out of normal message rendering entirely.
const MonacoEditor = dynamic(
  async () => {
    const mod = await import("@monaco-editor/react")
    return { default: mod.default }
  },
  {
    ssr: false,
    loading: () => <div className="h-full animate-pulse bg-muted/35" />,
  }
)

function monacoLanguageFor(language: BundledLanguage): string {
  switch (language) {
    case "bash":
      return "shell"
    case "javascript":
      return "javascript"
    case "json":
      return "json"
    case "diff":
      return "diff"
    default:
      return "plaintext"
  }
}

export function LargeToolOutputViewer({
  code,
  language,
  ariaLabel,
}: {
  code: string
  language: BundledLanguage
  ariaLabel: string
}) {
  // This component is rendered only after the detail disclosure opens, so
  // useMonaco() remains lazy for ordinary tool calls.
  const monaco = useMonaco()
  const editorTheme = useMonacoWorkspaceTheme(monaco)
  const { zoomLevel } = useZoomLevel()
  const { editorFontStack, editorFontSize, editorLigatures } = useEditorFont()
  const fontSize = (editorFontSize * zoomLevel) / 100
  const options = useMemo<MonacoEditorNs.IStandaloneEditorConstructionOptions>(
    () => ({
      readOnly: true,
      domReadOnly: true,
      ariaLabel,
      fontSize,
      fontFamily: editorFontStack,
      fontLigatures: editorLigatures,
      lineHeight: Math.round(fontSize * 1.5),
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 8,
      minimap: { enabled: false },
      glyphMargin: false,
      folding: false,
      wordWrap: "off",
      scrollBeyondLastLine: false,
      scrollBeyondLastColumn: 8,
      renderLineHighlight: "none",
      renderValidationDecorations: "off",
      overviewRulerLanes: 0,
      padding: { top: 8, bottom: 8 },
      unicodeHighlight: MONACO_UNICODE_HIGHLIGHT_OPTIONS,
      largeFileOptimizations: true,
      maxTokenizationLineLength: 20_000,
      stopRenderingLineAfter: 50_000,
      scrollbar: {
        horizontal: "auto",
        horizontalScrollbarSize: 6,
        vertical: "auto",
        verticalScrollbarSize: 6,
        useShadows: false,
      },
    }),
    [ariaLabel, editorFontStack, editorLigatures, fontSize]
  )

  return (
    <div className="h-[min(18rem,34vh)] min-h-32 w-full overflow-hidden">
      <MonacoEditor
        beforeMount={defineMonacoThemes}
        defaultLanguage={monacoLanguageFor(language)}
        defaultValue={code}
        height="100%"
        keepCurrentModel={false}
        language={monacoLanguageFor(language)}
        options={options}
        saveViewState={false}
        theme={editorTheme}
        value={code}
        width="100%"
      />
    </div>
  )
}
