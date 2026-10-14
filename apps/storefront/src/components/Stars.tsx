/**
 * A rating drawn as five stars. The picture is decorative (aria-hidden); the rating is always also said in words, so nothing depends
 * on seeing the stars or their color. A star is empty, half, or full: filled stars are orange with an ink outline, empty ones are
 * outlined only, so the difference is a shape and a fill, never color alone.
 */
function starPoints(): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? 10.5 : 4.4;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push([12 + radius * Math.cos(angle), 12.6 + radius * Math.sin(angle)]);
  }
  return points;
}

/** The part of the star left of the vertical middle (x <= 12): the polygon clipped against that line. */
function leftHalf(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  points.forEach((current, index) => {
    const next = points[(index + 1) % points.length]!;
    const inside = current[0] <= 12;
    const nextInside = next[0] <= 12;
    if (inside) out.push(current);
    if (inside !== nextInside) {
      const t = (12 - current[0]) / (next[0] - current[0]);
      out.push([12, current[1] + t * (next[1] - current[1])]);
    }
  });
  return out;
}

const toPath = (points: [number, number][]) =>
  `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;

const FULL = toPath(starPoints());
const HALF = toPath(leftHalf(starPoints()));

export type StarFill = 'full' | 'half' | 'empty';

/** Rounds to the nearest half star: 4.3 -> 4.5, 4.2 -> 4. */
export function starFills(value: number): StarFill[] {
  const halves = Math.max(0, Math.min(10, Math.round(value * 2)));
  return Array.from({ length: 5 }, (_, index) => {
    const left = halves - index * 2;
    return left >= 2 ? 'full' : left === 1 ? 'half' : 'empty';
  });
}

export function ratingWords(value: number): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} out of 5 stars`;
}

export function Stars({ value, spoken = true }: { value: number; spoken?: boolean }) {
  return (
    <span className="stars">
      {/* `spoken={false}` when the rating is already written out beside the stars. */}
      {spoken ? <span className="visually-hidden">Rated {ratingWords(value)}</span> : null}
      <svg className="stars__row" viewBox="0 0 120 24" aria-hidden="true" focusable="false">
        {starFills(value).map((fill, index) => (
          <g key={index} transform={`translate(${index * 24} 0)`}>
            <path d={FULL} className={fill === 'full' ? 'stars__on' : 'stars__off'} />
            {fill === 'half' ? <path d={HALF} className="stars__on stars__half" /> : null}
          </g>
        ))}
      </svg>
    </span>
  );
}
