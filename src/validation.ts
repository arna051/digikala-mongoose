import { ProductDraftInputSchema } from './contracts.js';
import {
  DigikalaCategoryValidationError,
  type DigikalaCategoryValidationIssue,
} from './errors.js';
import type {
  CategoryAttributeRule,
  CategoryFieldRule,
  ProductDraftInput,
} from './contracts.js';

export interface CategoryValidationRuleSet {
  categoryId: number;
  version: string;
  fields: readonly CategoryFieldRule[];
  attributeRules?: readonly CategoryAttributeRule[];
  expiresAt?: Date;
}

export interface CategoryValidationResult {
  valid: boolean;
  issues: DigikalaCategoryValidationIssue[];
  ruleVersion?: string;
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function typeMatches(
  value: unknown,
  rule: Pick<CategoryFieldRule, 'type'>,
): boolean {
  switch (rule.type) {
    case 'string':
    case 'image':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'select':
      return ['string', 'number', 'boolean'].includes(typeof value);
    case 'multiselect':
      return Array.isArray(value);
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
  }
}

function attributeValues(value: unknown): Map<number, unknown> {
  const result = new Map<number, unknown>();
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== 'object') return;
    const item = current as Record<string, unknown>;
    const id = Number(item.id);
    if (Number.isInteger(id) && id > 0 && 'value' in item) {
      result.set(id, item.value);
      return;
    }
    Object.values(item).forEach(visit);
  };
  visit(value);
  return result;
}

function zodIssueCode(code: string): DigikalaCategoryValidationIssue['code'] {
  switch (code) {
    case 'invalid_type':
      return 'invalid_type';
    case 'too_small':
      return 'too_small';
    case 'too_big':
      return 'too_big';
    case 'invalid_value':
      return 'invalid_value';
    default:
      return 'invalid_format';
  }
}

export function validateProductDraft(
  input: ProductDraftInput,
  rules?: CategoryValidationRuleSet,
): CategoryValidationResult {
  const base = ProductDraftInputSchema.safeParse(input);
  const issues: DigikalaCategoryValidationIssue[] = [];
  if (!base.success) {
    issues.push(
      ...base.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: zodIssueCode(issue.code),
        message: issue.message,
      })),
    );
    return { valid: false, issues, ruleVersion: rules?.version };
  }
  if (!rules) return { valid: true, issues };
  if (base.data.details.categoryId !== rules.categoryId) {
    issues.push({
      path: 'details.categoryId',
      code: 'invalid_value',
      message: `Category rule ${rules.categoryId} cannot validate category ${base.data.details.categoryId}`,
    });
    return { valid: false, issues, ruleVersion: rules.version };
  }
  if (rules.expiresAt && rules.expiresAt <= new Date()) {
    issues.push({
      path: 'details.categoryId',
      code: 'invalid_value',
      message: `Category rule ${rules.version} has expired and must be refreshed`,
    });
    return { valid: false, issues, ruleVersion: rules.version };
  }

  for (const rule of rules.fields) {
    const value = getPath(base.data, rule.path);
    if (empty(value)) {
      if (rule.required) {
        issues.push({
          path: rule.path,
          code: 'required',
          message: `${rule.label} is required`,
        });
      }
      continue;
    }
    if (!typeMatches(value, rule)) {
      issues.push({
        path: rule.path,
        code: 'invalid_type',
        message: `${rule.label} must be ${rule.type}`,
      });
      continue;
    }
    const comparable = typeof value === 'number' ? value : String(value).length;
    if (rule.min !== undefined && comparable < rule.min) {
      issues.push({
        path: rule.path,
        code: 'too_small',
        message: `${rule.label} must be at least ${rule.min}`,
      });
    }
    if (rule.max !== undefined && comparable > rule.max) {
      issues.push({
        path: rule.path,
        code: 'too_big',
        message: `${rule.label} must be at most ${rule.max}`,
      });
    }
    if (rule.pattern && typeof value === 'string') {
      try {
        if (!new RegExp(rule.pattern).test(value)) {
          issues.push({
            path: rule.path,
            code: 'invalid_format',
            message: `${rule.label} has an invalid format`,
          });
        }
      } catch {
        issues.push({
          path: rule.path,
          code: 'invalid_format',
          message: `${rule.label} has an invalid rule pattern`,
        });
      }
    }
    if (rule.values?.length) {
      const allowed = new Set(rule.values.map((item) => item.value));
      const selected = Array.isArray(value) ? value : [value];
      if (selected.some((item) => !allowed.has(item as never))) {
        issues.push({
          path: rule.path,
          code: 'invalid_value',
          message: `${rule.label} contains an unsupported value`,
        });
      }
    }
  }
  const attributes = attributeValues(base.data.attributes?.attributes);
  for (const rule of rules.attributeRules ?? []) {
    const path = `attributes.attributes.${rule.id}`;
    const value = attributes.get(rule.id);
    if (empty(value)) {
      if (rule.required) {
        issues.push({
          path,
          code: 'required',
          message: `${rule.label} is required`,
        });
      }
      continue;
    }
    if (!typeMatches(value, rule)) {
      issues.push({
        path,
        code: 'invalid_type',
        message: `${rule.label} must be ${rule.type}`,
      });
      continue;
    }
    if (rule.values?.length) {
      const allowed = new Set(rule.values.map((item) => item.value));
      const selected = Array.isArray(value) ? value : [value];
      if (selected.some((item) => !allowed.has(item as never))) {
        issues.push({
          path,
          code: 'invalid_value',
          message: `${rule.label} contains an unsupported value`,
        });
      }
    }
  }
  return { valid: issues.length === 0, issues, ruleVersion: rules.version };
}

export function assertValidProductDraft(
  input: ProductDraftInput,
  rules?: CategoryValidationRuleSet,
): void {
  const result = validateProductDraft(input, rules);
  if (!result.valid) throw new DigikalaCategoryValidationError(result.issues);
}
