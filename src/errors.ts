export class DigikalaMongooseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DigikalaMongooseError';
  }
}

export class DigikalaDocumentNotFoundError extends DigikalaMongooseError {
  constructor(entity: string, identifier: string) {
    super(`${entity} was not found: ${identifier}`);
    this.name = 'DigikalaDocumentNotFoundError';
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
