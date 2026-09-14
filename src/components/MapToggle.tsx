"use client";

import * as Checkbox from "@radix-ui/react-checkbox";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  position: { right: number; bottom: number } | null;
};

export default function HeadlineToggle({ checked, onCheckedChange, position }: Props) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox.Root renders a <button>, a labelable element
    <label className="headline-toggle" style={position ?? undefined}>
      <Checkbox.Root
        className="headline-toggle__box"
        checked={checked}
        onCheckedChange={(state) => onCheckedChange(state === true)}
      >
        <Checkbox.Indicator className="headline-toggle__indicator">
          <svg width="10" height="8" viewBox="0 0 10 8" aria-hidden="true">
            <path d="M1 4 L4 7 L9 1" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span className="headline-toggle__label">Headlines</span>
    </label>
  );
}
