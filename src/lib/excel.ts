
export interface Sheet {
  name: string;
  rows: (string | number | null | undefined)[][];
  widths?: number[];
}

export async function exportExcel(fileName: string, sheets: Sheet[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    const cols = s.widths || (s.rows[0] || []).map((_, i) => Math.min(50, Math.max(10, ...s.rows.map((r) => String(r[i] ?? '').length + 2))));
    ws['!cols'] = cols.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : fileName + '.xlsx');
}
