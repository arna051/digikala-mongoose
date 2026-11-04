import {
  Inject,
  Module,
  type DynamicModule,
  type InjectionToken,
  type ModuleMetadata,
} from '@nestjs/common';
import { createDigikalaMongoose, type DigikalaMongoose } from '../client.js';
import type { DigikalaMongooseOptions } from '../types.js';

export const DIGIKALA_MONGOOSE: InjectionToken = Symbol.for(
  'digikala-mongoose.instance',
);

export interface DigikalaMongooseModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: InjectionToken[];
  useFactory: (
    ...dependencies: any[]
  ) => Promise<DigikalaMongooseOptions> | DigikalaMongooseOptions;
}

export const InjectDigikalaMongoose = () => Inject(DIGIKALA_MONGOOSE);

@Module({})
export class DigikalaMongooseModule {
  static forRoot(options: DigikalaMongooseOptions): DynamicModule {
    const instance = createDigikalaMongoose(options);
    return {
      module: DigikalaMongooseModule,
      providers: [{ provide: DIGIKALA_MONGOOSE, useValue: instance }],
      exports: [DIGIKALA_MONGOOSE],
    };
  }

  static forRootAsync(
    options: DigikalaMongooseModuleAsyncOptions,
  ): DynamicModule {
    return {
      module: DigikalaMongooseModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: DIGIKALA_MONGOOSE,
          inject: options.inject ?? [],
          useFactory: async (
            ...dependencies: any[]
          ): Promise<DigikalaMongoose> =>
            createDigikalaMongoose(await options.useFactory(...dependencies)),
        },
      ],
      exports: [DIGIKALA_MONGOOSE],
    };
  }
}
