/**
 * TTL Parser implementation using N3.js.
 *
 * Parses Turtle (TTL) strings into RDF quads, returning either
 * the parsed quads or a ParseError with line number and message.
 */

import { Parser as N3Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import type { TtlParser, ParseResult, PrefixMap } from './interfaces.js';

/**
 * Concrete implementation of TtlParser backed by N3.js.
 *
 * After a successful parse, the discovered prefix declarations
 * are available via the `prefixes` property.
 */
export class N3TtlParser implements TtlParser {
  /** Prefix declarations discovered during the last successful parse. */
  prefixes: PrefixMap = {};

  parse(input: string): ParseResult<Quad[]> {
    const parser = new N3Parser();
    try {
      const quads: Quad[] = parser.parse(input, null, (prefix: string, ns: { value: string }) => {
        this.prefixes[prefix] = ns.value;
      }) as unknown as Quad[];
      return { ok: true, quads };
    }
    catch (err: unknown) {
      const { line, message } = extractError(err);
      return { ok: false, error: { line, message } };
    }
  }
}

/**
 * Extract a line number and message from an N3.js parse error.
 *
 * N3.js embeds the line number in the error message with the pattern
 * "on line N". We parse that out so callers get structured data.
 */
function extractError(err: unknown): { line: number; message: string } {
  const message = err instanceof Error ? err.message : String(err);

  // N3.js error messages typically contain "on line <number>"
  const lineMatch = message.match(/on line (\d+)/i);
  const line = lineMatch ? parseInt(lineMatch[1], 10) : 1;

  return { line, message };
}
