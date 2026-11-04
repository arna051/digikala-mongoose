import {
  CategoryRuleInputSchema,
  type CategoryAttributeRule,
  type CategoryFieldRule,
  type CategoryRuleData,
} from './contracts.js';
import { DigikalaCategoryNormalizationError } from './errors.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function positiveId(value: unknown, fallback?: string): number | undefined {
  const id = Number(value ?? fallback);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeType(source: unknown): CategoryAttributeRule['type'] {
  const type = String(source ?? '').toLowerCase();
  if (['number', 'numeric', 'integer', 'decimal', 'float'].includes(type)) {
    return 'number';
  }
  if (['select', 'radio', 'dropdown'].includes(type)) return 'select';
  if (
    ['multiselect', 'multi_select', 'checkbox', 'checkboxes'].includes(type)
  ) {
    return 'multiselect';
  }
  if (['boolean', 'bool', 'switch'].includes(type)) return 'boolean';
  if (['image', 'file'].includes(type)) return 'image';
  if (['object', 'json'].includes(type)) return 'object';
  return 'string';
}

function normalizeValues(value: unknown): CategoryAttributeRule['values'] {
  const entries = Array.isArray(value)
    ? value.map((item) => [undefined, item] as const)
    : Object.entries(record(value) ?? {});
  const normalized = entries.flatMap(([optionKey, item]) => {
    const detail = record(item);
    const primitive = ['string', 'number', 'boolean'].includes(typeof item)
      ? (item as string | number | boolean)
      : undefined;
    const rawValue =
      positiveId(optionKey) ??
      (detail?.value as string | number | boolean | undefined) ??
      primitive;
    const label =
      text(detail?.text) ??
      text(detail?.label) ??
      text(detail?.title) ??
      text(item) ??
      (rawValue === undefined ? undefined : String(rawValue));
    return rawValue === undefined || !label ? [] : [{ value: rawValue, label }];
  });
  return normalized.length ? normalized : undefined;
}

function dimensionRules(data: UnknownRecord): CategoryFieldRule[] {
  const rules: CategoryFieldRule[] = [];
  const required = boolean(data.dimensions_attribute_required);
  const enabled =
    boolean(data.dimensions_attribute) || boolean(data.attribute_dimensions);
  if (enabled) {
    for (const dimension of ['length', 'width', 'height'] as const) {
      if (dimension === 'height' && data.has_height === false) continue;
      rules.push({
        path: `attributes.${dimension}`,
        label: dimension,
        type: 'number',
        required,
        sortOrder: rules.length,
        metadata: {
          postfix: text(data.dimensions_attribute_postfix),
          hint: text(data.dimensions_attribute_hint),
        },
      });
    }
  }
  if (boolean(data.weight_attribute)) {
    rules.push({
      path: 'attributes.weight',
      label: 'weight',
      type: 'number',
      required: boolean(data.weight_attribute_required),
      sortOrder: rules.length,
      metadata: {
        postfix: text(data.weight_attribute_postfix),
        hint: text(data.weight_attribute_hint),
      },
    });
  }
  return rules;
}

export function normalizeDigikalaCategoryAttributes(input: {
  categoryId: number;
  response: unknown;
  version?: string;
  title?: string;
  fetchedAt?: Date;
  expiresAt?: Date;
}): CategoryRuleData {
  if (!Number.isInteger(input.categoryId) || input.categoryId <= 0) {
    throw new DigikalaCategoryNormalizationError(
      'categoryId must be a positive integer',
    );
  }
  const root = record(input.response);
  if (!root) {
    throw new DigikalaCategoryNormalizationError('expected an object response');
  }
  const status = text(root.status)?.toLowerCase();
  if (status && !['ok', 'success', 'successful'].includes(status)) {
    throw new DigikalaCategoryNormalizationError(
      `API returned status ${String(root.status)}`,
    );
  }
  const data = 'data' in root ? record(root.data) : root;
  if (!data) {
    throw new DigikalaCategoryNormalizationError(
      'response.data must be an object',
    );
  }
  const groups = record(data.category_group_attributes) ?? {};
  const attributeRules = new Map<number, CategoryAttributeRule>();

  for (const [groupKey, rawGroup] of Object.entries(groups)) {
    const group = record(rawGroup) ?? {};
    const groupId = positiveId(group.id, groupKey);
    const groupTitle = text(group.group_title) ?? text(group.title);
    const attributes = record(group.attributes) ?? {};
    for (const [attributeKey, rawAttribute] of Object.entries(attributes)) {
      const attribute = record(rawAttribute) ?? {};
      const id = positiveId(attribute.id, attributeKey);
      const label = text(attribute.title) ?? text(attribute.label);
      if (!id || !label) continue;
      const values = normalizeValues(attribute.values);
      if (attributeRules.has(id)) continue;
      attributeRules.set(id, {
        id,
        label,
        type: normalizeType(attribute.type),
        ...(text(attribute.type) ? { sourceType: text(attribute.type) } : {}),
        required: boolean(attribute.required),
        ...(groupId ? { groupId } : {}),
        ...(groupTitle ? { groupTitle } : {}),
        ...(text(attribute.unit) ? { unit: text(attribute.unit) } : {}),
        ...(text(attribute.postfix)
          ? { postfix: text(attribute.postfix) }
          : {}),
        ...(text(attribute.hint) ? { hint: text(attribute.hint) } : {}),
        ...(attribute.value === undefined
          ? {}
          : { defaultValue: attribute.value }),
        ...(values ? { values } : {}),
      });
    }
  }

  const fetchedAt = input.fetchedAt ?? new Date();
  return CategoryRuleInputSchema.parse({
    categoryId: input.categoryId,
    version: input.version ?? `${input.categoryId}:${fetchedAt.toISOString()}`,
    ...(input.title ? { title: input.title } : {}),
    fields: dimensionRules(data),
    attributeRules: [...attributeRules.values()],
    sourcePayload: input.response,
    fetchedAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  });
}
