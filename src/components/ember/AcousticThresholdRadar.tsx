import { cn } from "@/lib/utils";

const labels = ["Spectral Flux", "MFCC Deviation", "Pitch Escalation", "Breath Rate", "Spectral Centroid", "ZCR Density"];
const ringRatios = [0.33, 0.66, 1];
const ringLabels = ["Baseline", "Elevated", "Critical"];

export const AcousticThresholdRadar = ({ safeValues, dangerValues }: { safeValues: number[]; dangerValues: number[] }) => {
  const size = 520;
  const center = size / 2;
  const maxRadius = 188;

  const pointFor = (index: number, valueRatio: number) => {
    const angle = (-Math.PI / 2) + (index * (2 * Math.PI) / 6);
    const r = maxRadius * valueRatio;
    return {
      x: center + (Math.cos(angle) * r),
      y: center + (Math.sin(angle) * r),
    };
  };

  const polygonFromValues = (values: number[]) =>
    values
      .map((value, idx) => pointFor(idx, Math.min(1, Math.max(0, value / 100))))
      .map((p) => `${p.x},${p.y}`)
      .join(" ");

  const ringPolygon = (ratio: number) =>
    Array.from({ length: 6 })
      .map((_, idx) => pointFor(idx, ratio))
      .map((p) => `${p.x},${p.y}`)
      .join(" ");

  const safePolygon = polygonFromValues(safeValues);
  const dangerPolygon = polygonFromValues(dangerValues);

  return (
    <div className="h-full w-full flex items-center justify-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
        <defs>
          <radialGradient id="emberDangerFill" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="#E27533" stopOpacity="0.06" />
            <stop offset="70%" stopColor="#E27533" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#D6975A" stopOpacity="0.32" />
          </radialGradient>
          <filter id="emberGlow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {ringRatios.map((ratio) => (
          <polygon
            key={ratio}
            points={ringPolygon(ratio)}
            fill="none"
            stroke="#3A3E45"
            strokeDasharray="5 6"
            strokeWidth={1}
          />
        ))}

        {Array.from({ length: 6 }).map((_, idx) => {
          const p = pointFor(idx, 1);
          return <line key={idx} x1={center} y1={center} x2={p.x} y2={p.y} stroke="#3A3E45" strokeWidth={1} />;
        })}

        <polygon points={safePolygon} fill="#F2EEE3" fillOpacity={0.2} stroke="#F2EEE3" strokeWidth={1.6} />
        <polygon points={dangerPolygon} fill="url(#emberDangerFill)" stroke="#E27533" strokeWidth={2.2} filter="url(#emberGlow)" />

        {dangerValues.map((value, idx) => {
          const p = pointFor(idx, Math.min(1, Math.max(0, value / 100)));
          return <circle key={idx} cx={p.x} cy={p.y} r={4.6} fill="#E27533" filter="url(#emberGlow)" />;
        })}

        {labels.map((label, idx) => {
          const p = pointFor(idx, 1.13);
          return (
            <text
              key={label}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#9BA4B5"
              fontSize="11"
              fontFamily="Inter, sans-serif"
            >
              {label}
            </text>
          );
        })}

        {ringRatios.map((ratio, idx) => {
          const p = pointFor(0, ratio);
          return (
            <text
              key={ringLabels[idx]}
              x={p.x + 8}
              y={p.y - 8}
              fill="#8A95A5"
              fontSize="10"
              fontFamily="Inter, sans-serif"
            >
              {ringLabels[idx]}
            </text>
          );
        })}
      </svg>
    </div>
  );
};
