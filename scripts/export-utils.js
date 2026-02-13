function csvCell(value) {
  if (value == null) return "";
  const str = String(value);
  if (/[,"\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildCsv(rows, headers) {
  const lines = [];
  lines.push(headers.map(csvCell).join(","));
  rows.forEach((row) => {
    lines.push(headers.map((h) => csvCell(row[h])).join(","));
  });
  return `\ufeff${lines.join("\n")}`;
}

export function sanitizeFileToken(value) {
  return String(value || "item")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "item";
}

export function triggerDownload(content, filename, mime = "text/csv;charset=utf-8;") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

export async function downloadZip(filesMap, filename) {
  const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
  const zip = new JSZip();
  Object.entries(filesMap).forEach(([name, content]) => zip.file(name, content));
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, filename, "application/zip");
}
