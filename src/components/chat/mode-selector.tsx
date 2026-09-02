"use client"

import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import { SelectorTooltip } from "@/components/chat/selector-tooltip"
import type { SessionModeInfo } from "@/lib/types"

interface ModeSelectorProps {
  modes: SessionModeInfo[]
  selectedModeId: string | null
  onSelect: (modeId: string) => void
  label: string
}

export function InlineModeSelector({
  modes,
  selectedModeId,
  onSelect,
  label,
}: ModeSelectorProps) {
  const selected = modes.find((mode) => mode.id === selectedModeId)
  const currentLabel = selected?.name ?? selectedModeId ?? ""
  return (
    <DropdownMenu>
      <SelectorTooltip label={label} description={selected?.description}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            title={label}
            aria-label={currentLabel ? `${label}: ${currentLabel}` : label}
            className="min-w-0 gap-0.5 px-1 text-muted-foreground"
          >
            <span className="max-w-[10rem] truncate">{currentLabel}</span>
            <ChevronDown className="size-3 shrink-0 -translate-x-0.5 scale-90 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none group-hover/button:translate-x-0 group-hover/button:scale-100 group-hover/button:opacity-100 group-focus-visible/button:translate-x-0 group-focus-visible/button:scale-100 group-focus-visible/button:opacity-100 group-data-[state=open]/button:translate-x-0 group-data-[state=open]/button:scale-100 group-data-[state=open]/button:opacity-100" />
          </Button>
        </DropdownMenuTrigger>
      </SelectorTooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        className="max-h-[60vh] min-w-72 overflow-y-auto"
        style={{
          maxWidth: "min(20rem, calc(100vw - 1rem))",
        }}
      >
        <DropdownMenuRadioGroup
          value={selectedModeId ?? ""}
          onValueChange={onSelect}
        >
          {modes.map((mode) => (
            <DropdownMenuRadioItem key={mode.id} value={mode.id}>
              <DropdownRadioItemContent
                label={mode.name}
                description={mode.description}
              />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
