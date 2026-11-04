export class DigikalaMongooseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DigikalaMongooseError';
  }
}

export class DigikalaConfigurationError extends DigikalaMongooseError {
  constructor(message: string, options?: ErrorOptions) {
    super(`Invalid digikala-mongoose configuration: ${message}`, options);
    this.name = 'DigikalaConfigurationError';
  }
}

export class DigikalaDocumentNotFoundError extends DigikalaMongooseError {
  constructor(entity: string, identifier: string) {
    super(`${entity} was not found: ${identifier}`);
    this.name = 'DigikalaDocumentNotFoundError';
  }
}

export class DigikalaDuplicateIdentityError extends DigikalaMongooseError {
  constructor(
    public readonly entity: string,
    public readonly identifier: string,
    options?: ErrorOptions,
  ) {
    super(`${entity} already exists: ${identifier}`, options);
    this.name = 'DigikalaDuplicateIdentityError';
  }
}

export class DigikalaConcurrencyError extends DigikalaMongooseError {
  constructor(
    public readonly entity: string,
    public readonly identifier: string,
    options?: ErrorOptions,
  ) {
    super(`${entity} changed during the operation: ${identifier}`, options);
    this.name = 'DigikalaConcurrencyError';
  }
}

export class DigikalaUnsupportedSchemaVersionError extends DigikalaMongooseError {
  constructor(
    public readonly entity: string,
    public readonly foundVersion: number,
    public readonly supportedVersion: number,
  ) {
    super(
      `${entity} uses schema version ${foundVersion}, but this package supports up to ${supportedVersion}`,
    );
    this.name = 'DigikalaUnsupportedSchemaVersionError';
  }
}

export interface DigikalaStandaloneProgress {
  productKey: string;
  productId?: string;
  completedVariantKeys: string[];
  completedPublicationKeys: string[];
}

export class DigikalaIdentityConflictError extends DigikalaMongooseError {
  constructor(
    public readonly entity: 'product' | 'variant' | 'publication',
    public readonly identifier: string,
    message = `${entity} identity conflicts with existing data: ${identifier}`,
  ) {
    super(message);
    this.name = 'DigikalaIdentityConflictError';
  }
}

export class DigikalaStandaloneOperationError extends DigikalaMongooseError {
  constructor(
    public readonly step: string,
    public readonly progress: DigikalaStandaloneProgress,
    options?: ErrorOptions,
  ) {
    super(`Standalone catalog operation failed at ${step}`, options);
    this.name = 'DigikalaStandaloneOperationError';
  }
}

export class DigikalaCategoryValidationError extends DigikalaMongooseError {
  constructor(
    public readonly issues: readonly DigikalaCategoryValidationIssue[],
  ) {
    super(`Digikala category validation failed with ${issues.length} issue(s)`);
    this.name = 'DigikalaCategoryValidationError';
  }
}

export class DigikalaCategoryNormalizationError extends DigikalaMongooseError {
  constructor(message: string, options?: ErrorOptions) {
    super(`Digikala category response is invalid: ${message}`, options);
    this.name = 'DigikalaCategoryNormalizationError';
  }
}

export interface DigikalaCategoryValidationIssue {
  path: string;
  code:
    | 'required'
    | 'invalid_type'
    | 'invalid_value'
    | 'too_small'
    | 'too_big'
    | 'invalid_format';
  message: string;
}
