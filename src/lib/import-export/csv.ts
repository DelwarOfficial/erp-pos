// src/lib/import-export/csv.ts
// CSV parsing + generation utilities with formula-cell escaping.
// Per §6 rule 8 + §20.D11 — CSV/Excel exports must escape formula-leading
// cells (=, +, -, @) to prevent spreadsheet injection attacks.

/**
 * Escape a cell value to prevent spreadsheet formula injection.
 * If the value starts with =, +, -, or @, prefix with a single quote.
 * Also handles tab (T) and carriage return (CR) prefixes per OWASP guidance.
 */
export function escapeFormulaCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Check for formula-leading characters
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Parse a CSV string into rows (array of arrays).
 * Handles quoted fields, escaped quotes, and embedded newlines.
 */
export function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvText.length) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i += 2;
      } else if (char === '"') {
        // End of quoted field
        inQuotes = false;
        i++;
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\r' && nextChar === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i += 2;
      } else if (char === '\n' || char === '\r') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Last field
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Generate a CSV string from rows (array of arrays).
 * Applies formula-cell escaping to all values.
 */
export function generateCsv(rows: string[][], options?: { escapeFormulas?: boolean }): string {
  const escape = options?.escapeFormulas ?? true;
  return rows
    .map(row =>
      row
        .map(cell => {
          const escaped = escape ? escapeFormulaCell(cell) : String(cell ?? '');
          // Quote if contains comma, quote, newline, or starts with quote (from escaping)
          if (/[",\n\r]/.test(escaped) || escaped.startsWith("'")) {
            return `"${escaped.replace(/"/g, '""')}"`;
          }
          return escaped;
        })
        .join(','),
    )
    .join('\n');
}

/**
 * Validate a CSV row against expected column count.
 * Returns array of error messages (empty if valid).
 */
export function validateRowColumns(row: string[], expectedCount: number, rowNumber: number): string[] {
  const errors: string[] = [];
  if (row.length !== expectedCount) {
    errors.push(`Row ${rowNumber}: expected ${expectedCount} columns, got ${row.length}`);
  }
  return errors;
}

/**
 * Convert a row (string array) to a JSON object using header mapping.
 */
export function rowToObject(row: string[], headers: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length && i < row.length; i++) {
    obj[headers[i]] = row[i];
  }
  return obj;
}
