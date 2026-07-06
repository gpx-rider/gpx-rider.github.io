// Pure route-styling helpers. Map renderers can turn these runs into their
// own polyline elements without duplicating the grade-bucketing logic.

import { gradeAt } from "./route.mjs";

// Split a route path only when its grade-palette color changes. Adjacent runs
// share their boundary point, so separately rendered polylines remain a
// visually continuous route.
export function gradeColoredRouteSegments(route, path, colorForGrade) {
  return styledRouteSegments(route, path, ({ grade }) => {
    const color = colorForGrade(grade);
    return { key: color, color };
  });
}

// General form used when route state affects styling as well as grade (for
// example, replacing selected-climb runs with a wider highlighted treatment).
export function styledRouteSegments(route, path, styleAt) {
  if (!route?.length || !Array.isArray(path) || path.length < 2) return [];

  const segments = [];
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const fromDistance = Number(from.distance);
    const toDistance = Number(to.distance);
    if (!Number.isFinite(fromDistance) || !Number.isFinite(toDistance)) continue;

    const distance = (fromDistance + toDistance) / 2;
    const style = styleAt({ distance, grade: gradeAt(route, distance) });
    if (!style?.key) continue;
    const current = segments.at(-1);
    if (current?.key === style.key) {
      current.path.push(to);
    } else {
      segments.push({ ...style, path: [from, to] });
    }
  }
  return segments;
}
