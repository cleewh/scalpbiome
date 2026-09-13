import type { ReactNode } from "react";
import { InfoBubble } from "./InfoBubble";

interface Props {
  /** Panel heading. */
  title: string;
  /**
   * One-line plain-language explanation, always visible.
   * The bubble carries the depth; this carries the gist, so nobody has to
   * discover a hover interaction to understand what they are looking at.
   */
  subtitle: string;
  /** Long-form explanation shown in the help bubble. */
  help: ReactNode;
  /** Heading used inside the bubble; defaults to `title`. */
  helpTitle?: string;
  /** Preferred bubble alignment. */
  align?: "left" | "right" | "center";
  /** Optional content pinned to the right of the heading row. */
  right?: ReactNode;
}

export function PanelHeader({
  title,
  subtitle,
  help,
  helpTitle,
  align = "left",
  right,
}: Props) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="card-title">{title}</h3>
          <InfoBubble title={helpTitle ?? title} align={align}>
            {help}
          </InfoBubble>
        </div>
        {right}
      </div>
      <p className="mt-1 text-xs leading-snug text-white/55">{subtitle}</p>
    </div>
  );
}
