/** RFC-4180-ish CSV parser (quoted fields may contain commas, quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export interface BatchCase {
  jd: string;
  company_url: string;
  days: number;
}

/** Accepts the same JSON shape as `npm run evaluate`, or a CSV with jd, company_url[, days] columns. */
export function parseBatchFile(name: string, text: string, defaultDays: number): BatchCase[] {
  let items: Array<Record<string, unknown>>;
  if (name.toLowerCase().endsWith(".json") || text.trim().startsWith("[")) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("JSON file must contain an array of { jd, company_url, days } objects.");
    items = data;
  } else {
    const [header, ...rows] = parseCsv(text);
    if (!header) throw new Error("The file is empty.");
    const cols = header.map((h) => h.trim().toLowerCase());
    const ji = cols.findIndex((c) => ["jd", "job_description", "description"].includes(c));
    const ui = cols.findIndex((c) => ["company_url", "url", "company", "website"].includes(c));
    const di = cols.findIndex((c) => c === "days");
    if (ji < 0 || ui < 0) throw new Error('CSV needs a header row with "jd" and "company_url" columns.');
    items = rows.map((r) => ({ jd: r[ji], company_url: r[ui], days: di >= 0 ? r[di] : undefined }));
  }
  const out = items.map((it, i) => {
    const jd = String(it.jd ?? "").trim();
    const company_url = String(it.company_url ?? "").trim();
    const days = Number(it.days ?? defaultDays) || defaultDays;
    if (!jd || !company_url) throw new Error(`Row ${i + 1} is missing a job description or company URL.`);
    return { jd, company_url, days: Math.round(days) };
  });
  if (!out.length) throw new Error("No rows found.");
  if (out.length > 20) throw new Error("Up to 20 roles per upload.");
  return out;
}
