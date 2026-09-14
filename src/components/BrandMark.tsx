import FreshnessStamp from "./FreshnessStamp";

export default function BrandMark() {
  return (
    <div className="brand">
      <p className="brand__word">
        <span className="brand__o">
          O
          <span className="brand__dot" aria-hidden="true" />
        </span>
        yster News
      </p>

      <FreshnessStamp />
    </div>
  );
}
