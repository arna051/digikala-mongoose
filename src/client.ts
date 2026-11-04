import { createDigikalaModels, ensureDigikalaIndexes } from './models.js';
import {
  createDigikalaRepositories,
  type DigikalaMongooseRepositories,
} from './repositories.js';
import type {
  DigikalaMongooseModels,
  DigikalaMongooseOptions,
} from './types.js';

export interface DigikalaMongoose {
  models: DigikalaMongooseModels;
  repositories: DigikalaMongooseRepositories;
  ensureIndexes(): Promise<void>;
}

export function createDigikalaMongoose(
  options: DigikalaMongooseOptions,
): DigikalaMongoose {
  const models = createDigikalaModels(options);
  return {
    models,
    repositories: createDigikalaRepositories(models),
    ensureIndexes: () => ensureDigikalaIndexes(models),
  };
}
