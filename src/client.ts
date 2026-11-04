import { randomUUID } from 'node:crypto';
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
  const observe = async (
    event: Omit<
      Parameters<NonNullable<typeof options.observer>['onEvent']>[0],
      'eventId' | 'timestamp'
    >,
  ): Promise<void> => {
    try {
      await options.observer?.onEvent({
        ...event,
        eventId: randomUUID(),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Observability must not change database outcomes.
    }
  };
  const runObserved = async <T>(
    operation: 'database.migrate' | 'database.ensureIndexes',
    action: () => Promise<T>,
  ): Promise<T> => {
    const started = Date.now();
    await observe({ operation, phase: 'started' });
    try {
      const result = await action();
      await observe({
        operation,
        phase: 'succeeded',
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      await observe({
        operation,
        phase: 'failed',
        durationMs: Date.now() - started,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { name: 'UnknownError', message: String(error) },
      });
      throw error;
    }
  };
  return {
    models,
    repositories,
    standalone: createDigikalaStandaloneOrchestrator(repositories, {
      observer: options.observer,
    }),
    ensureIndexes: () =>
      runObserved('database.ensureIndexes', () =>
        ensureDigikalaIndexes(models),
      ),
    migrate: () =>
      runObserved('database.migrate', () => migrateDigikalaData(models)),
    ensureReady: async () => {
      const started = Date.now();
      await observe({ operation: 'database.ensureReady', phase: 'started' });
      try {
        const migration = await runObserved('database.migrate', () =>
          migrateDigikalaData(models),
        );
        await runObserved('database.ensureIndexes', () =>
          ensureDigikalaIndexes(models),
        );
        await observe({
          operation: 'database.ensureReady',
          phase: 'succeeded',
          durationMs: Date.now() - started,
          details: migration,
        });
        return migration;
      } catch (error) {
        await observe({
          operation: 'database.ensureReady',
          phase: 'failed',
          durationMs: Date.now() - started,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { name: 'UnknownError', message: String(error) },
        });
        throw error;
      }
    },
  };
}
