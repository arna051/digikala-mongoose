import {
  createDigikalaModels,
  ensureDigikalaIndexes,
  migrateDigikalaData,
} from './models.js';
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
  migrate(): Promise<{ migratedDocuments: number; schemaVersion: number }>;
  ensureReady(): Promise<{ migratedDocuments: number; schemaVersion: number }>;
}

export function createDigikalaMongoose(
  options: DigikalaMongooseOptions,
): DigikalaMongoose {
  const models = createDigikalaModels(options);
  const repositories = createDigikalaRepositories(models);
  return {
    models,
    repositories,
    standalone: createDigikalaStandaloneOrchestrator(repositories, {
      observer: options.observer,
    }),
    ensureIndexes: () => ensureDigikalaIndexes(models),
    migrate: () => migrateDigikalaData(models),
    ensureReady: async () => {
      const migration = await migrateDigikalaData(models);
      await ensureDigikalaIndexes(models);
      return migration;
    },
  };
}
