export function ago(at: number, now: number): string {
  if (Number.isNaN(at)) return "";

  const minutes = Math.floor((now - at) / 60_000);
  // Clock skew is real: a small negative age reads "just now", not "-3 minutes ago".
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "an hour ago";
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "a day ago" : `${days} days ago`;
}
