import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PatternConflictError, ValidationError } from '../registry/errors.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Body lỗi theo RFC 9457, giống gateway. */
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  [extension: string]: unknown;
}

/**
 * Dịch MỌI lỗi sang `application/problem+json`. Lớp duy nhất biết "lỗi core nào ứng với mã HTTP nào":
 * core ném ValidationError/PatternConflictError, không biết gì về 400/409.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Registry');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const problem = this.toProblem(exception);
    problem.instance = request.originalUrl;

    if (problem.status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));

    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ValidationError) {
      return {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        code: exception.code,
        detail: 'The registration is invalid.',
        errors: exception.issues,
      };
    }
    if (exception instanceof PatternConflictError) {
      return {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: exception.code,
        detail: exception.message,
        conflicts: exception.conflicts,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'object' && body && 'message' in body ? body.message : exception.message;
      return {
        type: 'about:blank',
        title: titleOf(status),
        status,
        detail: Array.isArray(message) ? message.join(' ') : String(message),
      };
    }
    // Lỗi của body-parser (JSON hỏng, body quá lớn) mang sẵn `status` và `type`.
    const parserError = exception as { status?: number; type?: string; message?: string };
    if (typeof parserError?.status === 'number' && parserError.status >= 400 && parserError.status < 500) {
      return {
        type: 'about:blank',
        title: titleOf(parserError.status),
        status: parserError.status,
        detail: parserError.type === 'entity.too.large' ? 'Request body is too large.' : parserError.message,
      };
    }
    return { type: 'about:blank', title: 'Internal Server Error', status: 500 };
  }
}

function titleOf(status: number): string {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    413: 'Content Too Large',
    415: 'Unsupported Media Type',
  };
  return titles[status] ?? (status >= 500 ? 'Internal Server Error' : 'Error');
}
