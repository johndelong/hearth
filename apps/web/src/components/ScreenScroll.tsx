import type { CSSProperties, ReactNode } from 'react';

/**
 * The one shape every tab screen's content area is built from: a bare
 * `overflow-y: auto` frame, flush to its container's true edges, wrapping a
 * plain content box that carries the page gutter (`.page-gutter` in
 * styles.css). The split is never optional and never applied by hand —
 * padding directly on a scrolling element isn't reliably scrollable to in
 * Chromium (its trailing edge just clips), and padding on the outer frame
 * would shrink what a child's `height: 100%` sees and inset its scrollbar
 * from the real edge. Using this even where nothing is tall enough to
 * scroll costs nothing — an `overflow-y: auto` box with room to spare never
 * shows a scrollbar — and it means every screen gets the same gutter the
 * same way, with no per-screen judgment call about whether it "needs" one.
 */
export function ScreenScroll({
  children,
  outerClassName,
  innerClassName = 'page-gutter',
  contentStyle,
}: {
  children: ReactNode;
  /** For the rare pane that also needs its own sizing class (Settings' side-by-side nav/content). */
  outerClassName?: string;
  /** Defaults to the standard page gutter; override only for a pane with its own inset rules. */
  innerClassName?: string;
  contentStyle?: CSSProperties;
}) {
  return (
    <div className={outerClassName} style={{ height: '100%', overflowY: 'auto' }}>
      <div className={innerClassName} style={contentStyle}>
        {children}
      </div>
    </div>
  );
}
