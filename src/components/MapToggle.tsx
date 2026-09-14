"use client";

import type { ReactNode } from "react";

type Props = {
  label: string;
  icon: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export default function MapToggle({ label, icon, checked, onCheckedChange }: Props) {
  return (
    <button
      type="button"
      className="map-icon-btn"
      data-state={checked ? "on" : "off"}
      aria-pressed={checked}
      aria-label={label}
      title={label}
      onClick={() => onCheckedChange(!checked)}
    >
      {icon}
    </button>
  );
}
