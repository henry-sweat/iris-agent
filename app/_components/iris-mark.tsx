import type { SVGProps } from "react";

const BANDS = [
  "M13 19C17.5 10.33 30.5 10.33 35 19",
  "M9.5 18C14.5 5.33 33.5 5.33 38.5 18",
  "M6 17C11.5 0.33 36.5 0.33 42 17",
] as const;

const OPACITY = [1, 0.6, 0.3] as const;

export type IrisMarkProps = SVGProps<SVGSVGElement> & {
  /** Accessible name. Pass an empty string when the mark sits next to visible "Iris" text. */
  title?: string;
};

/**
 * Iris logo mark. Draws in `currentColor`, so it follows your shadcn theme:
 * <IrisMark className="size-6 text-foreground" />
 */
export function IrisMark({ title = "Iris", strokeWidth = 2.25, ...props }: IrisMarkProps) {
  const decorative = title === "";
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      {...props}
    >
      <g transform="translate(24 24) scale(1.1) translate(-24 -12.25)">
        {BANDS.map((d, i) => (
          <path key={d} d={d} strokeOpacity={OPACITY[i]} />
        ))}
        <circle cx="24" cy="18.5" r="3" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
