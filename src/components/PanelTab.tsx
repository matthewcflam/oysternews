"use client";

export type PanelTabProps = {
  collapsed: boolean;
  onToggle: () => void;
  controls: string;
};

// Rendered inside `.panel`, so it shares the panel's drop shadow and rides its slide transform.
export default function PanelTab({ collapsed, onToggle, controls }: PanelTabProps) {
  return (
    <button
      type="button"
      className="panel__tab"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={controls}
      aria-label={collapsed ? "Expand panel" : "Collapse panel"}
    >
      <svg
        className="panel__tab-chevron"
        width="8"
        height="12"
        viewBox="0 0 8 12"
        aria-hidden="true"
      >
        <path d="M7 1L2 6L7 11" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </button>
  );
}
