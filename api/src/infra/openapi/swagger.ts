import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';

export class ApiErrorDto {
  @ApiProperty({ example: 400 }) statusCode!: number;
  @ApiProperty({ example: 'ERROR_VALIDATION', pattern: '^ERROR_[A-Z0-9_]+$' })
  code!: string;
  @ApiProperty({ example: 'Request validation failed' }) message!: string;
  @ApiPropertyOptional({
    oneOf: [
      { type: 'object', additionalProperties: true },
      {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    ],
  })
  details?: unknown;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
}
export class CursorPaginationDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 1000, default: 50 })
  limit!: number;
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export function ApiErrorResponses() {
  return applyDecorators(
    ApiExtraModels(ApiErrorDto),
    ...[
      400, 401, 403, 404, 409, 410, 413, 415, 422, 429, 500, 502, 503, 504,
    ].map((status) =>
      ApiResponse({
        status,
        schema: { $ref: getSchemaPath(ApiErrorDto) },
        ...(status === 429
          ? {
              headers: {
                'Retry-After': {
                  schema: { type: 'integer', minimum: 1 },
                  description: 'Seconds until a retry is allowed',
                },
              },
            }
          : {}),
      }),
    ),
  );
}
export function ApiCursorResponse() {
  return applyDecorators(
    ApiExtraModels(CursorPaginationDto),
    ApiResponse({
      status: 200,
      schema: {
        type: 'object',
        required: ['data', 'pagination'],
        properties: {
          data: { type: 'array', items: { type: 'object' } },
          pagination: { $ref: getSchemaPath(CursorPaginationDto) },
        },
      },
    }),
  );
}
