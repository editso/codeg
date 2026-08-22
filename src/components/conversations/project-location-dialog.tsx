"use client"

import { useEffect, useRef, useState } from "react"
import { FolderInput } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  DirectoryBrowser,
  type DirectoryBrowserHandle,
} from "@/components/shared/directory-browser"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { FolderDetail } from "@/lib/types"

interface ProjectLocationDialogProps {
  folder: FolderDetail | null
  blockedCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (folderId: number, path: string) => Promise<void>
}

/**
 * Picker for relocating a workspace project after its root was moved or renamed
 * outside Codeg. The selected location is committed only by the parent-provided
 * server operation, whose transaction updates the project atomically.
 */
export function ProjectLocationDialog({
  folder,
  blockedCount,
  open,
  onOpenChange,
  onConfirm,
}: ProjectLocationDialogProps) {
  const t = useTranslations("Folder.sidebar")
  const tCommon = useTranslations("Folder.common")
  const browserRef = useRef<DirectoryBrowserHandle>(null)
  const [candidatePath, setCandidatePath] = useState("")
  const [browserBusy, setBrowserBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const blockedReason =
    blockedCount > 0
      ? t("folderHeaderMenu.updateProjectLocationBusy", { count: blockedCount })
      : null

  useEffect(() => {
    if (!open || !folder) return
    setCandidatePath(folder.path)
    setBrowserBusy(false)
    setSubmitting(false)
  }, [open, folder])

  const handleConfirm = async () => {
    if (browserBusy || submitting || blockedReason || !folder) return
    const selected = await browserRef.current?.confirm()
    if (!selected) return
    setCandidatePath(selected)
    setSubmitting(true)
    try {
      await onConfirm(folder.id, selected)
      onOpenChange(false)
    } catch (error) {
      console.error("[ProjectLocationDialog] update project location failed:", error)
    } finally {
      setSubmitting(false)
    }
  }

  if (!folder) return null

  const confirmButton = (
    <Button
      onClick={() => void handleConfirm()}
      disabled={browserBusy || submitting || blockedReason !== null}
    >
      {t("folderHeaderMenu.updateProjectLocationTitle")}
    </Button>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-w-[min(42rem,calc(100vw-2rem))] gap-4 p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderInput className="size-4 text-muted-foreground" aria-hidden />
            {t("folderHeaderMenu.updateProjectLocationTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("folderHeaderMenu.updateProjectLocationDescription", {
              name: folder.name,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 text-xs">
          <div className="grid gap-0.5 rounded-md border border-border/70 bg-muted/25 px-3 py-2">
            <span className="text-muted-foreground">
              {t("folderHeaderMenu.currentProjectLocation")}
            </span>
            <code className="truncate font-mono text-foreground/80">
              {folder.path}
            </code>
          </div>
          <DirectoryBrowser
            ref={browserRef}
            active={open}
            initialPath={folder.path}
            value={candidatePath}
            onValueChange={setCandidatePath}
            onQuickSelect={setCandidatePath}
            onBusyChange={setBrowserBusy}
            heightClassName="h-[min(18rem,42vh)]"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            {tCommon("cancel")}
          </Button>
          {blockedReason ? (
            <TooltipProvider delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-not-allowed">
                    {confirmButton}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 text-center">
                  {blockedReason}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            confirmButton
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
