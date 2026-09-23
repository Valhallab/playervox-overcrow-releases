export const KEY = "checklist.v1";
export function decode(raw) {
  if (raw === null) return [];
  const data = JSON.parse(raw);
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.tasks) ||
    data.tasks.length > 100
  )
    throw new Error("invalid_data");
  return data.tasks.map((row) => {
    if (
      !row ||
      typeof row.text !== "string" ||
      !row.text.trim() ||
      row.text.length > 160 ||
      typeof row.done !== "boolean"
    )
      throw new Error("invalid_data");
    return { text: row.text, done: row.done };
  });
}
export function encode(tasks) {
  const raw = JSON.stringify({ version: 1, tasks });
  decode(raw);
  return raw;
}
