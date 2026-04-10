export const EXIT_PASS = 0;
export const EXIT_BLOCK = 1;
export const EXIT_ERROR = 2;

export class BlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockError';
  }
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function stderrBlock(message: string): void {
  console.error(`BLOCK: ${message}`);
}

export function stderrFix(message: string): void {
  console.error(message);
}
