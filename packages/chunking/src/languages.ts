const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  rs: 'rust',
  cpp: 'cpp',
  cc: 'cpp',
  c: 'c',
  h: 'c',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
};

export function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANGUAGE[ext] ?? null;
}

export function isSupportedFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return ext in EXT_TO_LANGUAGE;
}
