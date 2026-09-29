/**
 * Parse provider JSON without rounding integer tokens outside JavaScript's
 * safe range. Unsafe integers are represented as canonical decimal strings;
 * all other JSON values retain the native JSON.parse representation.
 */
export function parseJsonLossless(raw: string): unknown {
  let transformed = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < raw.length) {
    const character = raw[index]!;
    if (inString) {
      transformed += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (character === '"') {
      inString = true;
      transformed += character;
      index += 1;
      continue;
    }

    if (character === '-' || (character >= '0' && character <= '9')) {
      const numberMatch = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(raw.slice(index));
      if (numberMatch) {
        const token = numberMatch[0];
        if (!token.includes('.') && !/[eE]/.test(token)) {
          try {
            const integer = BigInt(token);
            if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) {
              transformed += JSON.stringify(integer.toString());
              index += token.length;
              continue;
            }
          } catch {
            // JSON.parse below remains the syntax authority for malformed input.
          }
        }
        transformed += token;
        index += token.length;
        continue;
      }
    }

    transformed += character;
    index += 1;
  }

  return JSON.parse(transformed) as unknown;
}
