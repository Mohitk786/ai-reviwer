/**
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
  const nameNode =
    node.childForFieldName?.('name') ??
    node.childForFieldName?.('identifier');
  return nameNode?.text ?? null;
}

/**
 * Walk the AST, calling callback on each node whose type is in targetTypes.
 * Does NOT recurse into matched nodes (avoids double-counting nested functions).
 */
function walkTree(node: any, targetTypes: Set<string>, callback: (n: any) => void): void {
  if (targetTypes.has(node.type as string)) {
    callback(node);
    return; 
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const child of node.children as any[]) {
    walkTree(child, targetTypes, callback);
  }
}


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


  /**
    * TO understand: har function, class, variable ek "node" hota hai tree mein.
    * tree.rootNode : Poori file ka starting point — ek root node jiske andar saari nested nodes hain:
    * targetTypes : ye hai jo types of nodes ham chahte hai chunk karne ke liye.
    * so we are only chunking the classes, functions, methods.
    */
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
