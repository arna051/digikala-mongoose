import { createDigikalaModels, ensureDigikalaIndexes } from './models.js';
import {
  createDigikalaRepositories,
  type DigikalaMongooseRepositories,
} from './repositories.js';
import {
  createDigikalaStandaloneOrchestrator,
  type DigikalaStandaloneOrchestrator,
} from './standalone.js';
import type {
  DigikalaMongooseModels,
  DigikalaMongooseOptions,
} from './types.js';

export interface DigikalaMongoose {
  models: DigikalaMongooseModels;
  repositories: DigikalaMongooseRepositories;
  standalone: DigikalaStandaloneOrchestrator;
  ensureIndexes(): Promise<void>;
}

export function createDigikalaMongoose(
  options: DigikalaMongooseOptions,
): DigikalaMongoose {
  const models = createDigikalaModels(options);
  const repositories = createDigikalaRepositories(models);
  return {
    models,
    repositories,
    standalone: createDigikalaStandaloneOrchestrator(repositories),
    ensureIndexes: () => ensureDigikalaIndexes(models),
  };
}
