/** Minimal single-page, text-only PDF writer for mock-mode exports. */
export function buildTextPdf(title: string, lines: string[]): Blob {
  const clean = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/([\\()])/g, "\\$1");

  const content: string[] = ["BT", "/F2 22 Tf", "56 780 Td", `(${clean(title)}) Tj`, "/F1 11 Tf", "0 -30 Td", "15 TL"];
  for (const line of lines.slice(0, 44)) content.push(`(${clean(line)}) '`);
  content.push("ET");
  const stream = content.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}
