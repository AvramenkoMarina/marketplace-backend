import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const asAny = exception as {
      status?: number;
      title?: string;
      name?: string;
      message?: string;
      errors?: { path?: string; message?: string }[];
    };

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail = 'Unexpected error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      title = HttpStatus[status] ?? exception.name;
      detail =
        typeof payload === 'string'
          ? payload
          : typeof payload === 'object' &&
              payload !== null &&
              'message' in payload
            ? Array.isArray((payload as { message: unknown }).message)
              ? ((payload as { message: string[] }).message).join('; ')
              : String((payload as { message: unknown }).message)
            : exception.message;
    } else if (typeof asAny.status === 'number') {
      status = asAny.status;
      title = asAny.title || asAny.name || (status >= 500 ? 'Internal Server Error' : 'Bad Request');
      detail = asAny.message || detail;
    } else if (exception instanceof Error) {
      detail = exception.message;
      title = exception.name || title;
    }

    if (asAny.errors?.length && asAny.message) {
      detail = asAny.message;
      status = asAny.status || status;
      title = asAny.title || title;
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title,
        status,
        detail,
        instance: req.originalUrl,
      });
  }
}
