import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Response } from 'express';
import * as Sentry from '@sentry/node';

const MULTER_FILE_TOO_LARGE_MESSAGE = 'File too large';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    // Structured fields beyond the standard NestJS-generated
    // {statusCode, message, error} shape — e.g. PlanGuard's `code`/
    // `requiredFeature` on a 403 — so callers can branch on something more
    // stable than matching the message string. Previously silently
    // dropped: this filter only ever read `.message` off the exception
    // body, no matter what else the thrower attached.
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else {
        const body = exceptionResponse as Record<string, unknown>;
        message = (body.message as string | string[]) || exception.message;
        const {
          statusCode: _statusCode,
          message: _message,
          error: _error,
          ...rest
        } = body;
        extra = rest;
      }

      if (Array.isArray(message)) {
        message = message[0];
      }

      if (
        exception instanceof PayloadTooLargeException &&
        message === MULTER_FILE_TOO_LARGE_MESSAGE
      ) {
        const maxBytes =
          Number.parseInt(process.env.MAX_FILE_UPLOAD_BYTES ?? '', 10) ||
          5 * 1024 * 1024;
        const maxMb = Math.round(maxBytes / (1024 * 1024));
        message = `The uploaded file exceeds the maximum allowed size of ${maxMb} MB. Please upload a smaller file.`;
      }

      if (status >= 500) {
        this.logger.error(`[${status}] ${message}`, exception.stack);
        Sentry.captureException(exception);
      } else {
        this.logger.warn(`[${status}] ${message}`);
      }
    } else {
      const stack =
        exception instanceof Error
          ? exception.stack
          : JSON.stringify(exception);
      this.logger.error('Unhandled exception', stack);
      Sentry.captureException(exception);
    }

    response.status(status).json({
      data: null,
      status,
      message,
      ...extra,
    });
  }
}
