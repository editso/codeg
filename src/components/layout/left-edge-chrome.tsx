"use client"

import { PanelLeft, PanelLeftOpen, Search } from "lucide-react"
import { useTranslations } from "next-intl"
import { isDesktop } from "@/lib/platform"
import { Button } from "@/components/ui/button"
import { useSearchDialog } from "@/contexts/search-dialog-context"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useIsMac } from "@/hooks/use-is-mac"
import { usePlatform } from "@/hooks/use-platform"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { useZoomLevel } from "@/hooks/use-appearance"
import { formatShortcutLabel } from "@/lib/keyboard-shortcuts"
import { MAC_TRAFFIC_LIGHT_INSET, leftChromeReserve } from "@/lib/window-chrome"
import { cn } from "@/lib/utils"
import { RemoteWorkspaceDropdown } from "./remote-workspace-dropdown"

/**
 * Contents of the window's fixed top-LEFT chrome overlay: the sidebar toggle,
 * search, and remote-workspace entry. `FolderLayoutShell` pins this at the
 * window's top-left corner so it
 * never moves — or re-mounts — when the sidebar opens or closes (that
 * re-parenting is what made the old in-header cluster flicker).
 *
 * A leading spacer clears the native macOS traffic lights; the cluster's fixed
 * width matches the reservation the window's left-edge column makes (see
 * `leftChromeReserve`), so tabs never render underneath. The trailing drag
 * filler lets the cluster's empty space move the window.
 *
 * Search sits here — rather than in the sidebar, where it used to be a fixed
 * nav row — precisely because this overlay never unmounts: the sidebar does,
 * which left ⌘K as the only path to it while collapsed. The remote-workspace
 * picker remains beside it for parity with the existing desktop workflow.
 *
 * "Open folder" and "summon pet" were intentionally dropped from here — Open
 * Folder / Clone remain reachable from the sidebar list's hover / empty-state
 * actions and ⌘O; the pet stays reachable from Settings › Appearance.
 */
export function LeftEdgeChrome() {
  const tTitleBar = useTranslations("Folder.folderTitleBar")
  const { isOpen, toggle } = useSidebarContext()
  const { setOpen: setSearchOpen } = useSearchDialog()
  const isMac = useIsMac()
  const { shortcuts } = useShortcutSettings()
  const { isMac: platformIsMac } = usePlatform()
  const { zoomLevel } = useZoomLevel()
  // The traffic lights only exist on the macOS desktop runtime (not web / not
  // Windows-Linux), so only reserve their inset there.
  const showMacInset = platformIsMac && isDesktop()
  const railCollapsed = !isOpen
  const SidebarIcon = railCollapsed ? PanelLeftOpen : PanelLeft

  return (
    <div
      className={cn(
        "flex h-full",
        railCollapsed && !showMacInset ? "items-start" : "items-center"
      )}
      style={{ width: leftChromeReserve(showMacInset, zoomLevel) }}
    >
      {showMacInset && (
        <div
          data-tauri-drag-region
          className="h-full shrink-0"
          style={{ width: MAC_TRAFFIC_LIGHT_INSET }}
        />
      )}
      <div
        className={cn(
          "flex items-center gap-1 pl-3",
          railCollapsed && !showMacInset && "pt-4"
        )}
      >
        <button
          type="button"
          className={cn(
            "inline-grid shrink-0 place-items-center outline-none",
            railCollapsed
              ? "inline-grid h-10 w-10 shrink-0 place-items-center rounded-xl text-foreground/65 outline-none transition-colors duration-200 hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              : "h-6 w-6 rounded-4xl text-foreground transition-colors hover:bg-foreground/10 hover:text-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:hover:bg-foreground/10"
          )}
          onClick={toggle}
          title={tTitleBar("withShortcut", {
            label: tTitleBar(isOpen ? "hideSidebar" : "showSidebar"),
            shortcut: formatShortcutLabel(shortcuts.toggle_sidebar, isMac),
          })}
          aria-label={tTitleBar(isOpen ? "hideSidebar" : "showSidebar")}
        >
          <SidebarIcon className={railCollapsed ? "h-5 w-5" : "h-3.5 w-3.5"} />
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 hover:bg-foreground/10 hover:text-foreground/80 dark:hover:bg-foreground/10"
          onClick={() => setSearchOpen(true)}
          title={tTitleBar("withShortcut", {
            label: tTitleBar("search"),
            shortcut: formatShortcutLabel(shortcuts.toggle_search, isMac),
          })}
          aria-label={tTitleBar("search")}
        >
          <Search aria-hidden="true" className="h-3.5 w-3.5" />
        </Button>
        <RemoteWorkspaceDropdown triggerClassName="h-6 w-6 hover:bg-foreground/10 hover:text-foreground/80 dark:hover:bg-foreground/10" />
      </div>
      {/* Empty tail is a window-drag region. */}
      <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
    </div>
  )
}
