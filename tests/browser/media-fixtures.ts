export function simplePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 30 350 Td (Hello PDF) Tj ET";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push(objects[2]!);
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(result.length);
    result += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = result.length;
  result +=
    `xref\n0 7\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Root 1 0 R /Size 7 >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(result);
}
