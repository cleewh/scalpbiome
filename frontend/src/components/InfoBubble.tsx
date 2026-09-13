import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Align = "left" | "right" | "center";

interface Props {
  /** Short heading for the bubble. */
  title: string;
  /** Body content. */
  children: ReactNode;
  /** Preferred horizontal anchoring relative to the trigger. */
  align?: Align;
  /** Accessible label for the trigger, defaults to "Explain <title>". */
  label?: string;
}

const PANEL_WIDTH = 340;
const VIEWPORT_MARGIN = 12;
const TRIGGER_GAP = 10;

// A LIGHT panel with dark text, deliberately inverted against the dark UI.
//
// This is a robustness choice, not an aesthetic one. A dark panel relies on light
// text actually being applied, and in environments that force their own colours
// (OS high-contrast, forced-colors mode, dark-mode browser extensions) that light
// text can be overridden to something dark and become invisible. Here the text is
// *meant* to be dark, so a forced dark colour still lands on a light surface and
// stays readable.
//
// #0f172a on #f8fafc is about 17:1, well past WCAG AAA, and reads cleanly from
// the back of a room. Every text node sets its colour explicitly rather than
// inheriting, and forcedColorAdjust opts the panel out of colour substitution.
const PANEL_BG = "#f8fafc";
const PANEL_TEXT = "#0f172a";
const PANEL_TITLE = "#0b1220";
const PANEL_BORDER = "#94a3b8";

/**
 * A help bubble: a "?" trigger that reveals an explanation.
 *
 * Why this renders through a portal
 * ---------------------------------
 * Every `.card` in this app uses `backdrop-blur`, and `backdrop-filter` creates
 * a new stacking context. An absolutely positioned popover inside a card is
 * therefore confined to that card's stacking level no matter how high its
 * z-index is, so later cards paint over it. Because those cards are
 * semi-transparent, the result looked like unreadable dark-on-dark text rather
 * than an obviously clipped element. Portalling to document.body escapes all of
 * it, and also lets the panel be clamped to the viewport so a bubble on the
 * right-hand tile cannot run off-screen.
 *
 * Accessibility
 * -------------
 *  - The trigger is a real <button>, reachable and operable by keyboard.
 *  - Opens on hover, on focus, and toggles on click / Enter / Space.
 *  - Escape closes it and returns focus to the trigger.
 *  - Moving the pointer from trigger into the panel keeps it open, so the text
 *    is selectable rather than vanishing mid-read.
 *  - Linked with aria-describedby so screen readers announce it on demand.
 */
export function InfoBubble({ title, children, align = "right", label }: Props) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false); // click-opened: ignores pointer-out
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Small grace period so the pointer can travel the gap into the panel.
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  const place = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();

    let left =
      align === "left"
        ? r.left
        : align === "right"
          ? r.right - PANEL_WIDTH
          : r.left + r.width / 2 - PANEL_WIDTH / 2;

    // Keep the panel fully on screen regardless of where the trigger sits.
    left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)
    );

    // Prefer below the trigger; flip above when there is not enough room.
    const panelHeight = panelRef.current?.offsetHeight ?? 220;
    const below = r.bottom + TRIGGER_GAP;
    const fitsBelow = below + panelHeight <= window.innerHeight - VIEWPORT_MARGIN;
    const top = fitsBelow
      ? below
      : Math.max(VIEWPORT_MARGIN, r.top - TRIGGER_GAP - panelHeight);

    setPos({ top, left });
  }, [align]);

  // Measure once the panel exists, then keep it anchored.
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  // Escape closes and restores focus.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Click outside closes a pinned bubble.
  useEffect(() => {
    if (!pinned) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (
        !buttonRef.current?.contains(t) &&
        !panelRef.current?.contains(t)
      ) {
        setOpen(false);
        setPinned(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pinned]);

  useEffect(() => cancelClose, [cancelClose]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label ?? `Explain ${title}`}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onClick={() => {
          cancelClose();
          const next = !open;
          setOpen(next);
          setPinned(next);
        }}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={() => {
          if (!pinned) scheduleClose();
        }}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={() => {
          if (!pinned) scheduleClose();
        }}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-[11px] font-bold leading-none text-white/70 transition hover:border-accent hover:bg-accent/30 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base-900"
      >
        ?
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={() => {
              if (!pinned) scheduleClose();
            }}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width: PANEL_WIDTH,
              // Portalled above everything, including the blurred cards that
              // previously painted over this panel.
              zIndex: 9999,
              background: PANEL_BG,
              backgroundColor: PANEL_BG,
              color: PANEL_TEXT,
              WebkitTextFillColor: PANEL_TEXT,
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: 12,
              padding: "14px 16px",
              boxShadow:
                "0 24px 50px -12px rgba(0,0,0,0.75), 0 0 0 1px rgba(15,23,42,0.06)",
              // Treat the panel as a light surface so the browser does not apply
              // dark-scheme substitutions inside it.
              colorScheme: "light",
              // Opt out of forced-colour overrides; the contrast here is already
              // ~17:1 and substitution only makes it worse.
              forcedColorAdjust: "none",
              // Opacity kept off the panel itself so text never blends with
              // whatever sits behind it.
              opacity: pos ? 1 : 0,
            }}
          >
            <p
              style={{
                margin: 0,
                marginBottom: 6,
                fontSize: 15,
                fontWeight: 700,
                color: PANEL_TITLE,
                WebkitTextFillColor: PANEL_TITLE,
                lineHeight: 1.3,
              }}
            >
              {title}
            </p>
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.55,
                color: PANEL_TEXT,
                WebkitTextFillColor: PANEL_TEXT,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {children}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * Paragraph helper for bubble bodies.
 *
 * Colour is set explicitly rather than inherited so a single failed inheritance
 * step cannot render the body invisible.
 */
export function P({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        color: PANEL_TEXT,
        WebkitTextFillColor: PANEL_TEXT,
      }}
    >
      {children}
    </p>
  );
}

/** Emphasised inline term. */
export function T({ children }: { children: ReactNode }) {
  return (
    <strong
      style={{
        color: PANEL_TITLE,
        WebkitTextFillColor: PANEL_TITLE,
        fontWeight: 700,
      }}
    >
      {children}
    </strong>
  );
}
