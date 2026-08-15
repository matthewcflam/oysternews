"use client";

/**
 * The panel's pull-out tab.
 *
 * **A component because both panels render it and it must behave identically**,
 * the same reason `MapTilerLogo` is one. It is a handle on the shared slot, not
 * a feature of either panel: whichever of the two is open, it is the same
 * control in the same place doing the same thing.
 *
 * The panel is not unmounted when it collapses — it slides off the left edge
 * under `transform`, tab included, so this button rides along and lands flush
 * against the viewport edge. That is what makes it reachable while collapsed,
 * and it is why the tab lives inside the panel rather than beside it.
 *
 * The glyph is a plain character rather than an icon: it is one arrow, and a
 * dependency or an inline SVG for one arrow is not a trade worth making.
 */
export default function PanelTab({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="panel__tab"
      onClick={onToggle}
      /*
       * `aria-expanded` says what the CONTROL does, and the label follows the
       * same rule — it names the action, not the current state, because that is
       * what a screen reader announces before the click.
       */
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Show panel" : "Hide panel"}
    >
      <span aria-hidden="true">{collapsed ? "▶" : "◀"}</span>
    </button>
  );
}
