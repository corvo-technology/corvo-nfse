import type { INestApplication, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig, OpenApiConfig } from '@/infra/config/configuration';
import { ApiErrorDto, CursorPaginationDto } from './swagger';

/** Builds the OpenAPI document of every route mounted on `app`, with the standard error responses. */
export function createOpenApiDocument(
  app: INestApplication,
  version: string,
  options: { standardResponses?: boolean; extraModels?: Type[] } = {},
) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Corvo API')
      .setVersion(version)
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' })
      .addCookieAuth('corvo_session')
      .build(),
    {
      extraModels: [
        ApiErrorDto,
        CursorPaginationDto,
        ...(options.extraModels ?? []),
      ],
    },
  );
  if (options.standardResponses === false) return document;
  // Protocol and operational endpoints retain their native schemas.
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (
      /\/health\/|\/webhooks\/stripe$|\/mcp(?:$|\/(?!connections))|\.well-known|\/auth\/oauth\/.*callback$/.test(
        path,
      )
    )
      continue;
    for (const method of ['get', 'post', 'patch', 'put', 'delete'] as const) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      for (const status of [
        '400',
        '401',
        '403',
        '404',
        '409',
        '410',
        '413',
        '415',
        '422',
        '429',
        '500',
        '502',
        '503',
        '504',
      ])
        operation.responses[status] = {
          description: 'Standard API error',
          ...(status === '429'
            ? {
                headers: {
                  'Retry-After': {
                    description: 'Retry delay in seconds',
                    schema: { type: 'integer', minimum: 1 },
                  },
                },
              }
            : {}),
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiErrorDto' },
            },
          },
        };
      for (const [status, response] of Object.entries(operation.responses)) {
        if (
          /\/(pdf|xml)$/.test(path) ||
          !/^2\d\d$/.test(status) ||
          status === '204' ||
          !response ||
          '$ref' in response
        )
          continue;
        const content = response.content?.['application/json'];
        const schema = content?.schema;
        if (
          schema &&
          !('$ref' in schema) &&
          (schema.properties?.pagination || schema.properties?.data)
        )
          continue;
        response.content = {
          'application/json': {
            schema: {
              type: 'object',
              required: ['data'],
              properties: { data: schema ?? {} },
            },
          },
        };
      }
    }
  }
  return document;
}

export function setupOpenApi(app: INestApplication, config: ConfigService) {
  const openApi = config.getOrThrow<OpenApiConfig>('openApi');
  if (!openApi.enabled) return;
  const appConfig = config.getOrThrow<AppConfig>('app');
  const document = createOpenApiDocument(app, appConfig.version);
  SwaggerModule.setup(`${appConfig.apiPrefix}/${openApi.path}`, app, document, {
    jsonDocumentUrl: `${appConfig.apiPrefix}/${openApi.jsonPath}`,
  });
}
