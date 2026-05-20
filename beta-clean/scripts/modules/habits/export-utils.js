function escapeCsvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(rows = [], headers = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeHeaders = Array.isArray(headers) && headers.length
    ? headers
    : Array.from(safeRows.reduce((set, row) => {
      if (row && typeof row === "object") {
        Object.keys(row).forEach((key) => set.add(key));
      }
      return set;
    }, new Set()));

  const lines = [];
  lines.push(safeHeaders.map(escapeCsvCell).join(","));
  safeRows.forEach((row) => {
    const record = row && typeof row === "object" ? row : {};
    const line = safeHeaders.map((key) => escapeCsvCell(record[key])).join(",");
    lines.push(line);
  });
  return `${lines.join("\n")}\n`;
}

export function triggerDownload(content, filename = "download.txt", mimeType = "text/plain;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([String(content ?? "")], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function sanitizeFileToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export async function downloadZip(files = {}, filename = "download.zip") {
  const entries = Object.entries(files || {});
  if (!entries.length) {
    triggerDownload("", filename, "application/zip");
    return;
  }

  if (typeof window !== "undefined" && window.fflate?.zipSync) {
    const input = {};
    entries.forEach(([name, content]) => {
      input[name] = new TextEncoder().encode(String(content ?? ""));
    });
    const bytes = window.fflate.zipSync(input);
    triggerDownload(new Blob([bytes], { type: "application/zip" }), filename, "application/zip");
    return;
  }

  const separator = "\n\n=====\n\n";
  const fallback = entries
    .map(([name, content]) => `# ${name}\n${String(content ?? "")}`)
    .join(separator);
  triggerDownload(fallback, filename.replace(/\.zip$/i, ".txt"), "text/plain;charset=utf-8");
}
