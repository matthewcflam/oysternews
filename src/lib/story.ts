import { ago } from "./age";

// The allowlist that enforces link-out only. Widening it to make a test pass is the failure mode.
export type PanelStory = {
  title: string;
  source: string;
  url: string;
  place: string;
  kind: string;
  date: string;
  image: string;
  more: string[];
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// Checked again at the render door: these become hrefs, and javascript:/data: turn links into code.
const isLinkable = (url: string) => /^https?:\/\//i.test(url);

// The field list is the copyright enforcement point: nothing else on the feature is read.
export function panelStory(properties: unknown): PanelStory | null {
  if (!properties || typeof properties !== "object") return null;
  const source = properties as Record<string, unknown>;
  const url = text(source.url);
  if (!url) return null;

  return {
    title: text(source.title),
    source: text(source.source),
    url,
    place: text(source.place),
    kind: text(source.kind),
    date: text(source.date),
    image: text(source.image),
    more: text(source.more).split("\n").map(text).filter(isLinkable),
  };
}

export function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const SHORT_COUNTRY: Record<string, string> = {
  "United States": "USA",
  "United States of America": "USA",
  "United Kingdom": "UK",
};

export function shortCountry(name: string): string {
  return SHORT_COUNTRY[name] ?? name;
}

export function placeLine(story: Pick<PanelStory, "place" | "kind">): string {
  const parts = text(story.place)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  const last = parts.length - 1;
  parts[last] = shortCountry(parts[last]);

  const place = parts.join(", ");
  return story.kind === "CONTAINER" ? `Somewhere in ${place}` : place;
}

export function publishedAt(date: string, now: number = Date.now()): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(date ?? "");
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match.map(Number);

  return ago(Date.UTC(year, month - 1, day, hour, minute, second), now);
}
