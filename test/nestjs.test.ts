import { Mongoose } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  DIGIKALA_MONGOOSE,
  DigikalaMongooseModule,
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
});
