/**
 * Lỗi nghiệp vụ của core. Core không biết HTTP; lớp HTTP (problem.filter.ts) dịch chúng
 * sang mã trạng thái: ValidationError → 400, PatternConflictError → 409.
 */

export class ValidationError extends Error {
  readonly code = 'INVALID_REGISTRATION';

  /** Gom MỌI lỗi để client sửa một lần, không phải thử từng lỗi. */
  constructor(readonly issues: string[]) {
    super(`Invalid request (${issues.length} issue(s)): ${issues.join(' ')}`);
    this.name = 'ValidationError';
  }
}

export class PatternConflictError extends Error {
  readonly code = 'PATTERN_CONFLICT';

  constructor(readonly conflicts: Array<{ pattern: string; owner: string }>) {
    super(
      conflicts
        .map((c) => `Pattern "${c.pattern}" is already handled by service "${c.owner}".`)
        .join(' '),
    );
    this.name = 'PatternConflictError';
  }
}
