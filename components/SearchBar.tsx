"use client";

/**
 * The favicon and the search field, centred over the top of the map.
 *
 * A real combobox now: typing filters `lib/place-search.ts`'s ranked list of
 * countries, admin-1 regions and continents; picking a row calls `onSelect`,
 * which `MapView` uses to fly the camera and open the region panel — the same
 * panel a label click opens. Every id offered here came off the build's own
 * join (`scripts/build-boundaries.ts`), never off the typed text itself — see
 * docs/DESIGN.md#the-label-based-gesture-and-no-name-matching-ever.
 *
 * **The mark stopped being the pin (2026-08-15).** It was the map's own `#D24F39`
 * disc, ringed and highlighted like a top-5 story. Mode 1 now draws real stories
 * in exactly that orange with their headlines attached, an inch below this, so a
 * decorative copy of the mark read as a sixth story that would not open. The
 * mockup makes it a purple sphere instead: still a mark, no longer a claim. Its
 * highlight moved to the wordmark, where it is an orange bead in the "O".
 */

import { useEffect, useId, useRef, useState } from "react";
import { countryName } from "@/lib/flag";
import {
  loadPlaceIndex,
  searchablePlaces,
  searchPlaces,
  type PlaceEntry,
} from "@/lib/place-search";

export type SearchBarProps = {
  onSelect: (place: PlaceEntry) => void;
};

/** The match itself is synchronous over ~3,900 rows; this only smooths keystrokes. */
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

  useEffect(() => {
    setHighlighted(0);
  }, [debouncedQuery]);

  // Loaded on first focus, not on mount and not on first keystroke — in memory
  // by the time a query exists, without costing every reader who never
  // searches a fetch.
  const handleFocus = () => {
    setOpen(true);
    if (places) return;
    loadPlaceIndex()
      .then((index) => setPlaces(searchablePlaces(index)))
      .catch(() => {
        // Silent by design, same as the bbox table: the search box just
        // offers nothing rather than showing a page-level error over a map
        // that is otherwise healthy.
      });
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
        // MapView binds a window-level Escape to close the panels
        // (MapView.tsx) — one keypress must not do both.
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

  // A mouse click on a row fires blur first; the timeout lets that click's
  // own handler run before the list unmounts out from under it.
  const handleBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    setTimeout(() => setOpen(false), 0);
  };

  const hasQuery = debouncedQuery.trim() !== "";
  // The dropdown opens on any typed query, not just a matched one — a blank
  // panel where a list used to be reads as broken, not as "nothing here".
  const showDropdown = open && hasQuery;

  return (
    <div className="search" ref={rootRef}>
      <span className="search__mark" />

      {/* Positions the list — `.search__box` is the containing block, so the
          list's left edge tracks the field's regardless of the mark's width. */}
      <div className="search__box">
        <form className="search__field" role="search" onSubmit={handleSubmit}>
          <input
            className="search__input"
            type="text"
            placeholder="The world is yours"
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
          >
            <circle cx="8" cy="8" r="5" />
            <path d="M11.8 11.8 L16.4 16.4" />
          </svg>
        </form>

        {showDropdown ? (
          <ul className="search__list" id={listId} role="listbox">
            {suggestions.length > 0 ? (
              suggestions.map((place, index) => (
                <li
                  key={place.id}
                  id={`${listId}-${place.id}`}
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
