/**
 * Lenient JSON extraction for model output: strips code fences and prose,
 * removes trailing commas, and closes a truncated object/array. Anything this
 * can't rescue is reported as a parse failure and the caller retries.
 */
export function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)(```|$)/i);
  if (fence && fence[1].trim()) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start < 0) throw new SyntaxError("No JSON object found in model output");
  s = s.slice(start);

  try {
    return JSON.parse(s);
  } catch {
    /* fall through to repair */
  }
  const cleaned = closeTruncated(removeTrailingCommas(trimToBalanced(s)));
  return JSON.parse(cleaned);
}

/** Cut anything after the outermost value closes (models like to add a sentence after). */
function trimToBalanced(s: string): string {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return s;
}

function removeTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
}

function closeTruncated(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  if (!stack.length && !inStr) return s;
  let out = s;
  if (inStr) out += '"';
  // Drop a dangling key or partial element, then close.
  out = out.replace(/,\s*"[^"]*"\s*:?\s*$/, "").replace(/[,:]\s*$/, "");
  return removeTrailingCommas(out + stack.reverse().join(""));
}
