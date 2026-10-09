const BOM = '\uFEFF';

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
}

function cellValue(row, column) {
  return typeof column.value === 'function' ? column.value(row) : row[column.value];
}

/** يبني نص CSV من صفوف وأعمدة محددة. */
export function toCsv(rows, columns) {
  const header = columns.map((column) => escapeCell(column.label)).join(',');
  const body = rows
    .map((row) => columns.map((column) => escapeCell(cellValue(row, column))).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

/** طابع زمني مناسب لأسماء الملفات: 2024-05-31_14-20 */
export function csvStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

/**
 * ينزّل ملف CSV مع BOM حتى تفتحه Excel بالعربية بشكل صحيح.
 * الأرقام تُصدَّر بصيغتها الرقمية (لا أرقام عربية) لتظل قابلة للحساب.
 */
export function downloadCsv(filename, rows, columns) {
  const csv = toCsv(rows, columns);
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
