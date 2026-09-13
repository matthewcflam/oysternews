"use client";

import { useEffect, useId, useRef, useState } from "react";
import { countryName } from "@/lib/flag";
import {
  loadPlaceIndex,
  type PlaceEntry,
  searchablePlaces,
  searchPlaces,
} from "@/lib/place-search";

export type SearchBarProps = {
  onSelect: (place: PlaceEntry) => void;
};

const DEBOUNCE_MS = 120;

export default function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [places, setPlaces] = useState<PlaceEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const suggestions = places ? searchPlaces(places, debouncedQuery) : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: `debouncedQuery` is the trigger; a new query resets the highlight
  useEffect(() => {
    setHighlighted(0);
  }, [debouncedQuery]);

  const handleFocus = () => {
    setOpen(true);
    if (places) return;
    loadPlaceIndex()
      .then((index) => setPlaces(searchablePlaces(index)))
      .catch(() => {});
  };

  const select = (place: PlaceEntry) => {
    onSelect(place);
    setQuery("");
    setDebouncedQuery("");
    setOpen(false);
    rootRef.current?.querySelector("input")?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open) {
        // MapView binds Escape on window to close the panels: one keypress must not do both.
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (!open || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((i) => (i - 1 + suggestions.length) % suggestions.length);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const picked = suggestions[highlighted];
    if (picked) select(picked);
  };

  // A click on a row fires blur first; the timeout lets its handler run before the list unmounts.
  const handleBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    setTimeout(() => setOpen(false), 0);
  };

  const hasQuery = debouncedQuery.trim() !== "";
  const showDropdown = open && hasQuery;

  return (
    <div className="search" ref={rootRef}>
      <span className="search__mark" />

      <div className="search__box">
        {/* biome-ignore lint/a11y/useSemanticElements: <search> would change the element the search__field styles target */}
        <form className="search__field" role="search" onSubmit={handleSubmit}>
          <input
            className="search__input"
            type="text"
            placeholder="Find a Country/State"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              showDropdown && suggestions[highlighted]
                ? `${listId}-${suggestions[highlighted].id}`
                : undefined
            }
          />
          <svg
            className="search__icon"
            viewBox="0 0 19 19"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="5" />
            <path d="M11.8 11.8 L16.4 16.4" />
          </svg>
        </form>

        {showDropdown ? (
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA combobox listbox; focus stays on the input
          <ul className="search__list" id={listId} role="listbox">
            {suggestions.length > 0 ? (
              suggestions.map((place, index) => (
                // biome-ignore lint/a11y/useFocusableInteractive: combobox option, reached via aria-activedescendant
                // biome-ignore lint/a11y/useKeyWithClickEvents: the input's onKeyDown handles arrow keys and Enter
                <li
                  key={place.id}
                  id={`${listId}-${place.id}`}
                  // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA combobox option
                  role="option"
                  aria-selected={index === highlighted}
                  className="search__option"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => select(place)}
                >
                  {place.name}
                  {place.kind === "state" && place.parent ? (
                    <span className="search__option-parent"> · {countryName(place.parent)}</span>
                  ) : null}
                </li>
              ))
            ) : (
              <li className="search__empty" role="presentation">
                No matching results. Search a country or state.
              </li>
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
