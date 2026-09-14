"use client";

import MapToggle from "./MapToggle";

// Both glyphs' ink spans the full width, so equal cell padding gives equal visible gaps.
export const ICON_SIZE = 20;

export type PanelPos = { right: number; bottom: number; height: number; paddingRight: number };

type Props = {
  position: PanelPos | null;
  headlinesOn: boolean;
  onHeadlinesChange: (on: boolean) => void;
  labelsOn: boolean;
  onLabelsChange: (on: boolean) => void;
};

const HeadlinesIcon = (
  <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 20 20" aria-hidden="true">
    <path
      d="M2.5 1.5H17.5A2.5 2.5 0 0 1 20 4V10A2.5 2.5 0 0 1 17.5 12.5H5.5L0 18.5V4A2.5 2.5 0 0 1 2.5 1.5Z"
      fill="currentColor"
    />
  </svg>
);

const LabelsIcon = (
  <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 20 20" aria-hidden="true">
    <path
      d="M0.9 0.9H10L19.1 10L10 19.1L0.9 10Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <circle cx="5.6" cy="5.6" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

// Sits under MapLibre's zoom group (z-index 2), so its right end reads as the group's backing.
export default function CornerPanel({
  position,
  headlinesOn,
  onHeadlinesChange,
  labelsOn,
  onLabelsChange,
}: Props) {
  return (
    <div className="corner-panel" style={position ?? undefined}>
      <MapToggle
        label="Headlines"
        icon={HeadlinesIcon}
        checked={headlinesOn}
        onCheckedChange={onHeadlinesChange}
      />
      <MapToggle
        label="Labels"
        icon={LabelsIcon}
        checked={labelsOn}
        onCheckedChange={onLabelsChange}
      />
    </div>
  );
}
