/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- reads decorator metadata of arbitrary classes */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PUBLIC_OPERATION_EXTENSION } from '@/modules/auth/api-key-endpoint.decorator';
import {
  ScheduleResponseDto,
  ScheduleRunResponseDto,
} from '@/modules/invoice-schedule/http/schedule.dto';
import {
  CancelNfeDto,
  CorrectNfeDto,
  InutilizeNfeDto,
} from '@/modules/nfe/http/nfe-event.dto';
import { NfceRequestDto } from '@/modules/nfce/http/nfce.dto';
import { NfeRequestDto } from '@/modules/nfe/http/nfe.dto';
import { createOpenApiDocument } from './setup';
import { toPublicDocument, type OpenApiDocument } from './public-document';

const MODULES_DIR = join(__dirname, '..', '..', 'modules');
/** Where @nestjs/swagger stores `@ApiExtension()` values on a handler. */
const API_EXTENSION = 'swagger/apiExtension';
const CONTROLLER_FILE = /\.controller\.(?:ts|js)$/;

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return CONTROLLER_FILE.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

function hasPublicOperation(controller: Type<unknown>): boolean {
  return Object.getOwnPropertyNames(controller.prototype).some(
    (name) =>
      name !== 'constructor' &&
      (
        Reflect.getMetadata(API_EXTENSION, controller.prototype[name]) as
          Record<string, unknown> | undefined
      )?.[PUBLIC_OPERATION_EXTENSION] === true,
  );
}

/** Every controller that exposes at least one public operation (`@ApiKeyEndpoint()` or `@PublicApiEndpoint()`). */
export function discoverPublicControllers(): Type<unknown>[] {
  const found = new Set<Type<unknown>>();
  for (const file of controllerFiles(MODULES_DIR).sort()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (
        typeof value === 'function' &&
        Reflect.hasMetadata('path', value) &&
        hasPublicOperation(value as Type<unknown>)
      )
        found.add(value as Type<unknown>);
    }
  }
  return [...found];
}

/**
 * Boots only the public controllers (every dependency is an empty stub, so no
 * database or Redis is touched) and returns the public OpenAPI document.
 */
export async function generatePublicDocument(
  version: string,
  apiPrefix = 'v1',
): Promise<OpenApiDocument> {
  const moduleRef = await Test.createTestingModule({
    controllers: discoverPublicControllers(),
  })
    .useMocker(() => ({}))
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  try {
    app.setGlobalPrefix(apiPrefix);
    await app.init();
    return toPublicDocument(
      createOpenApiDocument(app, version, {
        standardResponses: false,
        extraModels: [
          ScheduleResponseDto,
          ScheduleRunResponseDto,
          NfeRequestDto,
          NfceRequestDto,
          CancelNfeDto,
          CorrectNfeDto,
          InutilizeNfeDto,
        ],
      }),
      apiPrefix,
    );
  } finally {
    await app.close();
  }
}
