/** Best-effort extraction of a JSON object from a model response that may include stray prose/markdown fences. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return candidate;
  return candidate.slice(start, end + 1);
}
