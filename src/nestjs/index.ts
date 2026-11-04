import {
  Inject,
  Module,
  type DynamicModule,
  type InjectionToken,
  type ModuleMetadata,
} from '@nestjs/common';
import { createDigikalaMongoose, type DigikalaMongoose } from '../client.js';
import type { DigikalaMongooseOptions } from '../types.js';

export function getDigikalaMongooseToken(name = 'default'): InjectionToken {
  return Symbol.for(`digikala-mongoose.instance.${name}`);
}

export const DIGIKALA_MONGOOSE: InjectionToken = getDigikalaMongooseToken();

export interface DigikalaMongooseModuleOptions {
  name?: string;
  autoEnsureReady?: boolean;
}

export interface DigikalaMongooseModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  name?: string;
  autoEnsureReady?: boolean;
  inject?: InjectionToken[];
  useFactory: (
    ...dependencies: any[]
  ) => Promise<DigikalaMongooseOptions> | DigikalaMongooseOptions;
}

export const InjectDigikalaMongoose = (name = 'default') =>
  Inject(getDigikalaMongooseToken(name));

async function initialize(
  options: DigikalaMongooseOptions,
  autoEnsureReady: boolean,
): Promise<DigikalaMongoose> {
  const instance = createDigikalaMongoose(options);
  if (autoEnsureReady) await instance.ensureReady();
  return instance;
}

@Module({})
export class DigikalaMongooseModule {
  static forRoot(
    options: DigikalaMongooseOptions,
    moduleOptions: DigikalaMongooseModuleOptions = {},
  ): DynamicModule {
    const token = getDigikalaMongooseToken(moduleOptions.name);
    return {
      module: DigikalaMongooseModule,
      providers: [
        {
          provide: token,
          useFactory: () =>
            initialize(options, moduleOptions.autoEnsureReady ?? false),
        },
      ],
      exports: [token],
    };
  }

  static forRootAsync(
    options: DigikalaMongooseModuleAsyncOptions,
  ): DynamicModule {
    const token = getDigikalaMongooseToken(options.name);
    return {
      module: DigikalaMongooseModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: token,
          inject: options.inject ?? [],
          useFactory: async (
            ...dependencies: any[]
          ): Promise<DigikalaMongoose> =>
            initialize(
              await options.useFactory(...dependencies),
              options.autoEnsureReady ?? false,
            ),
        },
      ],
      exports: [token],
    };
  }
}
