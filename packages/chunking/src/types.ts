export interface CodeChunk {
  content: string;
  filePath: string;
  language: string;
  /** Null when the chunk is a whole file (no named functions/classes found). */
  functionName: string | null;
  startLine: number;
  endLine: number;
}
