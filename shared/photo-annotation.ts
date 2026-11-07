export const inkColors = ['#000000', '#ffffff', '#d62828', '#1764c0', '#c59b32'] as const;
export const inkWidths = [0.003, 0.007, 0.014] as const;
export type InkStroke = { color: string; width: number; points: [number, number][] };
export type Annotation = { version: 1; space: 'exif-oriented-normalized'; strokes: InkStroke[] };
export const emptyAnnotation = (): Annotation => ({ version: 1, space: 'exif-oriented-normalized', strokes: [] });
export function parseAnnotation(value: unknown): Annotation {
  const fail = (): never => { throw new Error('ANNOTATION_INVALID'); };
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 300_000) return fail();
  const a = value as Annotation;
  if (Object.keys(a).sort().join(',') !== 'space,strokes,version' || a.version !== 1 || a.space !== 'exif-oriented-normalized' || !Array.isArray(a.strokes) || a.strokes.length > 200) return fail();
  let count = 0;
  return { version: 1, space: a.space, strokes: a.strokes.map(s => {
    if (!s || Object.keys(s).sort().join(',') !== 'color,points,width' || !inkColors.some(c => c === s.color) || !inkWidths.some(w => w === s.width) || !Array.isArray(s.points) || !s.points.length) return fail();
    count += s.points.length; if (count > 10_000) return fail();
    return { color: s.color, width: s.width, points: s.points.map(p => {
      if (!Array.isArray(p) || p.length !== 2 || !p.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return fail();
      return [p[0], p[1]];
    }) };
  }) };
}
// Only canonical numeric coordinates and allowlisted colors reach this renderer.
export function strokePath(stroke: InkStroke, width: number, height: number) {
  return stroke.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * width).toFixed(3)} ${(y * height).toFixed(3)}`).join(' ');
}
export function annotationSvg(a: Annotation, width: number, height: number) {
  const strokes = parseAnnotation(a).strokes.map(s => {
    const thickness = s.width * Math.min(width, height);
    if (s.points.length === 1) return `<circle cx="${s.points[0][0] * width}" cy="${s.points[0][1] * height}" r="${thickness / 2}" fill="${s.color}"/>`;
    return `<path d="${strokePath(s, width, height)}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${strokes}</svg>`;
}
