import { Mongoose } from 'mongoose';
import type { FactoryProvider } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  DIGIKALA_MONGOOSE,
  DigikalaMongooseModule,
  getDigikalaMongooseToken,
} from '../src/nestjs/index.js';

describe('NestJS module', () => {
  it('registers one injectable package instance from an existing connection', () => {
    const mongoose = new Mongoose();
    const connection = mongoose.createConnection();
    const module = DigikalaMongooseModule.forRoot({
      connection,
      autoCreateIndexes: false,
    });

    expect(module.exports).toContain(DIGIKALA_MONGOOSE);
    expect(module.providers).toEqual([
      expect.objectContaining({ provide: DIGIKALA_MONGOOSE }),
    ]);
  });

  it('creates distinct tokens for named connections without eager setup', () => {
    const mongoose = new Mongoose();
    const connection = mongoose.createConnection();
    const first = DigikalaMongooseModule.forRoot(
      { connection, modelPrefix: 'First', autoCreateIndexes: false },
      { name: 'first' },
    );
    const second = DigikalaMongooseModule.forRoot(
      { connection, modelPrefix: 'Second', autoCreateIndexes: false },
      { name: 'second' },
    );

    expect(first.exports).toContain(getDigikalaMongooseToken('first'));
    expect(second.exports).toContain(getDigikalaMongooseToken('second'));
    expect(first.providers).toEqual([
      expect.objectContaining({ useFactory: expect.any(Function) }),
    ]);
  });

  it('initializes sync and async factories lazily', async () => {
    const mongoose = new Mongoose();
    const connection = mongoose.createConnection();
    const direct = DigikalaMongooseModule.forRoot({
      connection,
      modelPrefix: 'DirectFactory',
      autoCreateIndexes: false,
    });
    const directProvider = direct.providers![0] as FactoryProvider;
    await expect(directProvider.useFactory()).resolves.toMatchObject({
      repositories: expect.any(Object),
    });

    const asynchronous = DigikalaMongooseModule.forRootAsync({
      name: 'async',
      inject: [],
      useFactory: () => ({
        connection,
        modelPrefix: 'AsyncFactory',
        autoCreateIndexes: false,
      }),
    });
    const asyncProvider = asynchronous.providers![0] as FactoryProvider;
    await expect(asyncProvider.useFactory()).resolves.toMatchObject({
      standalone: expect.any(Object),
    });
  });
});
