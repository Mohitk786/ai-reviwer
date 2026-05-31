/**
 * AST-based code chunker using Tree-sitter.
 *
 * Chunks at function/class/method boundaries — never by character count.
 * Falls back to whole-file chunking for unsupported languages.
 *
 * Tree-sitter is a native CJS module. Imported via createRequire so this ESM
 * package can load it without transpiling it.
 */

import { createRequire } from 'module';
import type { CodeChunk } from './types.js';
import { detectLanguage } from './languages.js';

const require = createRequire(import.meta.url);

const CHUNK_TYPES: Record<string, string[]> = {
  typescript: [
    'function_declaration',
    'method_definition',
    'class_declaration',
  ],
  tsx: [
    'function_declaration',
    'method_definition',
    'class_declaration',
  ],
  javascript: [
    'function_declaration',
    'method_definition',
    'class_declaration',
  ],
  python: [
    'function_definition',
    'class_definition',
  ],
};

// Cache parsers per language — creating a Parser per file is expensive.
const parserCache = new Map<string, any>();

function getParser(language: string): any | null {
  if (parserCache.has(language)) return parserCache.get(language);

  try {
   
    const Parser = require('tree-sitter') as any;
    const parser = new Parser();

    if (language === 'typescript') {
      const { typescript } = require('tree-sitter-typescript') as any;
      parser.setLanguage(typescript);
    } else if (language === 'tsx') {
      const { tsx } = require('tree-sitter-typescript') as any;
      parser.setLanguage(tsx);
    } else if (language === 'javascript') {
      const { typescript } = require('tree-sitter-typescript') as any;
      parser.setLanguage(typescript);
    } else if (language === 'python') {
      const Python = require('tree-sitter-python') as any;
      parser.setLanguage(Python);
    } else {
      return null;
    }

    parserCache.set(language, parser);
    return parser;
  } catch {
    parserCache.set(language, null);
    return null;
  }
}

function extractName(node: any): string | null {
  // tree-sitter field names for the identifier differ by node type.
  const nameNode =
    node.childForFieldName?.('name') ??
    node.childForFieldName?.('identifier');
  return nameNode?.text ?? null;
}

/**
 * Walk the AST, calling callback on each node whose type is in targetTypes.
 * Does NOT recurse into matched nodes (avoids double-counting nested functions).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkTree(node: any, targetTypes: Set<string>, callback: (n: any) => void): void {
  if (targetTypes.has(node.type as string)) {
    callback(node);
    return; // don't descend into matched node
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const child of node.children as any[]) {
    walkTree(child, targetTypes, callback);
  }
}

/**
 * Chunk a source file into AST-level units (functions, classes, methods).
 * Returns an empty array for unsupported file types.
 */
export function chunkFile(content: string, filePath: string): CodeChunk[] {
  const language = detectLanguage(filePath);
  if (!language) return [];

  const parser = getParser(language);
  const targetTypes = CHUNK_TYPES[language];

  if (!parser || !targetTypes) {
    // Unsupported language — treat the whole file as one chunk.
    return [wholeFileChunk(content, filePath, language)];
  }

  const tree = parser.parse(content) as any;
  const sourceLines = content.split('\n');
  const chunks: CodeChunk[] = [];

  walkTree(tree.rootNode, new Set(targetTypes), (node) => {
    const startLine = (node.startPosition.row as number) + 1;
    const endLine = (node.endPosition.row as number) + 1;

    // Include up to 3 lines of preceding context so the LLM sees function signature
    // neighbours (e.g., decorators, comments, const assignments for arrow functions).
    const contextStartRow = Math.max(0, (node.startPosition.row as number) - 3);
    const prefix = sourceLines.slice(contextStartRow, node.startPosition.row as number).join('\n');
    const body = content.slice(node.startIndex as number, node.endIndex as number);
    const chunkContent = prefix ? `${prefix}\n${body}` : body;

    chunks.push({
      content: chunkContent,
      filePath,
      language,
      functionName: extractName(node),
      startLine,
      endLine,
    });
  });

  if (chunks.length === 0) {
    // File has no named functions/classes (e.g., pure config, barrel re-exports).
    return [wholeFileChunk(content, filePath, language)];
  }

  return chunks;
}

function wholeFileChunk(content: string, filePath: string, language: string): CodeChunk {
  return {
    content,
    filePath,
    language,
    functionName: null,
    startLine: 1,
    endLine: content.split('\n').length,
  };
}
