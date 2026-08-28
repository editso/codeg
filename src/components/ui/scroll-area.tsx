"use client"

import { useCallback, useMemo, useRef } from "react"
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react"
import type { OverlayScrollbarsComponentProps } from "overlayscrollbars-react"
import type { OverlayScrollbars } from "overlayscrollbars"

const overlayScrollbarElements = new WeakMap<HTMLElement, HTMLElement[]>()
let activeOverlayScrollbarHost: HTMLElement | null = null

function setActiveOverlayScrollbarHost(host: HTMLElement | null) {
  if (activeOverlayScrollbarHost === host) return

  const previous = activeOverlayScrollbarHost
  if (previous) {
    for (const scrollbar of overlayScrollbarElements.get(previous) ?? []) {
      delete scrollbar.dataset.codegScrollbarActive
    }
  }

  activeOverlayScrollbarHost = host
  if (host) {
    for (const scrollbar of overlayScrollbarElements.get(host) ?? []) {
      scrollbar.dataset.codegScrollbarActive = "true"
    }
  }
}

type ScrollAreaProps = {
  children: React.ReactNode
  className?: string
  x?: "scroll" | "hidden"
  y?: "scroll" | "hidden"
  onScroll?: (event: Event) => void
  /**
   * Receives the real scrollable viewport element once OverlayScrollbars has
   * initialized (and `null` on destroy). Needed when an external library — e.g.
   * a `virtua` Virtualizer — must bind to the actual scroll container rather
   * than the host. Because the component initializes with `defer`, reading the
   * viewport synchronously after mount is racy; this fires at the right time.
   */
  onViewportRef?: (element: HTMLElement | null) => void
  /**
   * Writing direction for the scrollport. Worth setting to `"ltr"` for content
   * that is inherently left-to-right whatever the UI language — source code,
   * diffs, paths — because the scroll container's own direction is what fixes
   * both the layout and the sign of `scrollLeft` (an RTL scrollport reports 0
   * at its right edge and counts down into negatives).
   */
  dir?: "ltr" | "rtl"
  ref?: React.Ref<OverlayScrollbarsComponentRef>
}

const BASE_OPTIONS: OverlayScrollbarsComponentProps["options"] = {
  scrollbars: {
    theme: "os-theme-codeg",
    autoHide: "leave",
    clickScroll: true,
  },
}

export function ScrollArea({
  children,
  className,
  x = "hidden",
  y = "scroll",
  onScroll,
  onViewportRef,
  dir,
  ref,
}: ScrollAreaProps) {
  const overlayHoverCleanupRef = useRef<(() => void) | null>(null)

  const syncOverlayScrollbarState = useCallback(
    (instance: OverlayScrollbars) => {
      const { host } = instance.elements()
      const { x, y } = instance.state().hasOverflow
      host.dataset.codegOverlayScrollbarScrollable = String(x || y)

      if (!x && !y && activeOverlayScrollbarHost === host) {
        setActiveOverlayScrollbarHost(null)
      }
    },
    []
  )

  const bindOverlayScrollbarHover = useCallback(
    (instance: OverlayScrollbars) => {
      overlayHoverCleanupRef.current?.()

      const { host, viewport, scrollbarHorizontal, scrollbarVertical } =
        instance.elements()
      const scrollbars = [
        scrollbarHorizontal.scrollbar,
        scrollbarVertical.scrollbar,
      ]

      overlayScrollbarElements.set(host, scrollbars)
      host.dataset.codegOverlayScrollbar = "true"
      // The transcript's native-scrollbar coordinator uses this marker to
      // recognize an OverlayScrollbars viewport as the deepest hovered region.
      // That stops an ancestor native scrollbar from appearing alongside it.
      viewport.dataset.codegScrollbar = "true"
      for (const scrollbar of scrollbars) {
        scrollbar.dataset.codegOverlayScrollbar = "true"
      }
      syncOverlayScrollbarState(instance)

      const resolveScrollableHost = (target: EventTarget | null) => {
        const targetElement = target instanceof Element ? target : null
        let candidate = targetElement?.closest<HTMLElement>(
          "[data-codeg-overlay-scrollbar]"
        )

        while (candidate) {
          if (candidate.dataset.codegOverlayScrollbarScrollable === "true") {
            return candidate
          }
          candidate = candidate.parentElement?.closest<HTMLElement>(
            "[data-codeg-overlay-scrollbar]"
          )
        }

        return null
      }

      const activateForTarget = (target: EventTarget | null) => {
        setActiveOverlayScrollbarHost(resolveScrollableHost(target))
      }
      const onPointerMove = (event: PointerEvent) => {
        activateForTarget(event.target)
      }
      const onPointerLeave = (event: PointerEvent) => {
        activateForTarget(event.relatedTarget)
      }

      host.addEventListener("pointermove", onPointerMove)
      host.addEventListener("pointerleave", onPointerLeave)
      overlayHoverCleanupRef.current = () => {
        host.removeEventListener("pointermove", onPointerMove)
        host.removeEventListener("pointerleave", onPointerLeave)
        if (activeOverlayScrollbarHost === host) {
          setActiveOverlayScrollbarHost(null)
        }
        overlayScrollbarElements.delete(host)
        delete host.dataset.codegOverlayScrollbar
        delete host.dataset.codegOverlayScrollbarScrollable
        delete viewport.dataset.codegScrollbar
        for (const scrollbar of scrollbars) {
          delete scrollbar.dataset.codegOverlayScrollbar
          delete scrollbar.dataset.codegScrollbarActive
        }
      }
    },
    [syncOverlayScrollbarState]
  )

  const options = useMemo<OverlayScrollbarsComponentProps["options"]>(
    () => ({
      ...BASE_OPTIONS,
      overflow: { x, y },
    }),
    [x, y]
  )

  const events = useMemo<OverlayScrollbarsComponentProps["events"]>(
    () => ({
      ...(onScroll ? { scroll: (_instance, event) => onScroll(event) } : {}),
      initialized: (instance) => {
        bindOverlayScrollbarHover(instance)
        onViewportRef?.(instance.elements().viewport)
      },
      updated: (instance) => syncOverlayScrollbarState(instance),
      destroyed: () => {
        overlayHoverCleanupRef.current?.()
        overlayHoverCleanupRef.current = null
        onViewportRef?.(null)
      },
    }),
    [
      bindOverlayScrollbarHover,
      onScroll,
      onViewportRef,
      syncOverlayScrollbarState,
    ]
  )

  return (
    <OverlayScrollbarsComponent
      ref={ref}
      className={className}
      dir={dir}
      options={options}
      events={events}
      defer
    >
      {children}
    </OverlayScrollbarsComponent>
  )
}
