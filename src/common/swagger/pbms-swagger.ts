import { applyDecorators, type Type } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';

export function pbmsEnvelope(message: string, result: unknown, statusCode = 200) {
  return {
    statusCode,
    message,
    isSuccess: true,
    result,
  };
}

/** Envelope Swagger cho response PBMS; `result` được điền object/list thật, không `{}`. */
export function ApiPbmsOkResponse(message: string, result: unknown, statusCode = 200) {
  return applyDecorators(
    ApiResponse({
      status: statusCode,
      description: message,
      schema: {
        type: 'object',
        properties: {
          statusCode: { type: 'integer', example: statusCode },
          message: { type: 'string', example: message },
          isSuccess: { type: 'boolean', example: true },
          result: { example: result },
        },
        example: pbmsEnvelope(message, result, statusCode),
      },
    }),
  );
}

/** Example Value trên body — chỉ field camelCase dùng cho endpoint đó. */
export function ApiPbmsBodyExample(type: Type<unknown>, value: Record<string, unknown>) {
  return ApiBody({
    type,
    examples: {
      default: {
        value,
      },
    },
  });
}
