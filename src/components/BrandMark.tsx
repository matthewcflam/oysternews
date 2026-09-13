import FreshnessStamp from "./FreshnessStamp";

export default function BrandMark() {
  return (
    <div className="brand">
      <p className="brand__word">
        Oyster
        <span className="brand__dot" aria-hidden="true" />
      </p>

      <FreshnessStamp />
    </div>
  );
}
