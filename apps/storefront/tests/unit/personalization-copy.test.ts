import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { addLine } from '@/lib/cart/cart-state';
import { lineKey, optionSummary, validateOptions, type OptionValues } from '@kcpw/contracts';
import {
  CABLE_COLOR_HELP,
  ICON_HELP,
  NAME_HELP,
  proposedOptions,
} from '@/lib/catalog/display-policy';
import { shopperIssues, shopperMessage } from '@/lib/handoff/messages';

const bagTag = proposedOptions('Personalized Bag Tag').schema;

describe('the personalization fields a shopper sees when WooCommerce stores no setup for the product', () => {
  it('say exactly what the owner asked for, in plain words', () => {
    const byId = Object.fromEntries(bagTag.fields.map((f) => [f.id, f]));
    expect(byId.name?.helpText).toBe("Enter the name exactly as you'd like it printed.");
    expect(byId.icon?.helpText).toBe('Enter an available icon name, such as Dog, Cat, or Flower.');
    expect(byId.cable_color?.helpText).toBe('Enter your preferred cable color.');
    expect([NAME_HELP, ICON_HELP, CABLE_COLOR_HELP]).toEqual([
      byId.name?.helpText,
      byId.icon?.helpText,
      byId.cable_color?.helpText,
    ]);
  });

  it('carry no development note, on any personalized product', () => {
    for (const title of ['Personalized Bag Tag', 'Personalized Keychain', 'Custom Name Plaque']) {
      for (const field of proposedOptions(title).schema.fields) {
        const placeholder = 'placeholder' in field ? (field.placeholder ?? '') : '';
        const text = `${field.label} ${field.helpText ?? ''} ${placeholder}`;
        expect(text, `${title}: ${field.id}`).not.toMatch(
          /proposed|for review|personali[sz]ation notes|will become|safer than|real cable|emoji/i,
        );
      }
    }
  });

  it('keep the same fields, ids, requirements and limits (the name is required; icon and cable color are optional)', () => {
    expect(bagTag.fields.map((f) => [f.id, f.type, f.required])).toEqual([
      ['name', 'text', true],
      ['icon', 'text', false],
      ['cable_color', 'text', false],
    ]);
    expect(proposedOptions('Personalized Keychain').schema.fields.map((f) => f.id)).toEqual([
      'name',
    ]);
    expect(proposedOptions('Plain Mug').proposed).toBe(false);
  });

  it('accept an icon NAME such as Flower (the old four-character emoji limit would have refused it) and a cable color', () => {
    for (const icon of ['Dog', 'Cat', 'Flower']) {
      const result = validateOptions(bagTag, { name: 'Robin', icon, cable_color: 'Black' });
      expect(result.ok, icon).toBe(true);
    }
    expect(validateOptions(bagTag, { name: 'Robin' }).ok).toBe(true);
    expect(validateOptions(bagTag, { icon: 'Dog' }).ok).toBe(false); // the name is still required
  });
});

describe('what is saved with the cart line and handed to the shop', () => {
  const options: OptionValues = { name: 'Robin', icon: 'Flower', cable_color: 'Black' };

  it('is every typed value, per line, so two bag tags with different choices never merge', () => {
    const a = { productId: 889, variationId: 5, quantity: 1, options };
    const lines = addLine(addLine([], a), { ...a, options: { ...options, name: 'Bea' } });
    expect(lines).toHaveLength(2);
    expect(lineKey(lines[0]!)).not.toBe(lineKey(lines[1]!));
    expect(lines[0]!.options).toEqual(options);
  });

  it('is described to the seller with each field’s label and the exact value', () => {
    const validation = validateOptions(bagTag, options);
    if (!validation.ok) throw new Error('should validate');
    expect(optionSummary(bagTag, validation.values)).toEqual([
      { fieldId: 'name', label: 'Name or short text', value: 'Robin' },
      { fieldId: 'icon', label: 'Icon', value: 'Flower' },
      { fieldId: 'cable_color', label: 'Cable color', value: 'Black' },
    ]);
  });
});

describe('what a shopper reads when the shop refuses a personalization it has no setup for', () => {
  const unknown = (field: string) => ({
    code: 'invalid_option',
    field,
    message: `Unknown option "${field}".`,
  });

  it('is a plain sentence, said once, never the developer wording', () => {
    expect(shopperMessage(unknown('name'))).toMatch(/not available to order online right now/);
    const issues = shopperIssues([unknown('name'), unknown('icon'), unknown('cable_color')]);
    expect(issues).toHaveLength(1);
    expect(JSON.stringify(issues)).not.toMatch(/Unknown option/);
  });

  it('leaves the shop’s other messages exactly as they are', () => {
    const real = {
      code: 'invalid_option',
      field: 'name',
      message: 'Name or short text is required.',
    };
    expect(shopperIssues([real])).toEqual([real]);
    const stock = { code: 'out_of_stock', message: 'Bag tag is out of stock.' };
    expect(shopperMessage(stock)).toBe('Bag tag is out of stock.');
  });
});

describe('the setup the owner pastes into the product (docs/BAG-TAG-PERSONALIZATION.md)', () => {
  it('is exactly the default fields the storefront shows, so the page reads the same before and after it is stored', () => {
    const doc = readFileSync(
      path.resolve(import.meta.dirname, '../../../../docs/BAG-TAG-PERSONALIZATION.md'),
      'utf8',
    );
    const block = /```json\n([\s\S]+?)\n```/.exec(doc)?.[1];
    expect(block).toBeTruthy();
    expect(JSON.parse(block!)).toEqual(bagTag);
  });
});
