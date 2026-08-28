import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttributeFilter, MetaModel, ObjectType } from '@bizzdesign/sdk-bundle/browser';
import type { AttributeChoice } from './attributes';
import {
  FilterStore,
  isSameAttribute,
  scopeExcluding,
  scopeFor,
  selectionFor,
  type AttributeSelection,
} from './filter';

function attribute(definitionId: string, categoryId = 'category'): AttributeChoice {
  return {
    categoryId,
    categoryName: 'Category',
    definitionId,
    name: definitionId,
    kind: 'enum',
  };
}

/**
 * A selection carries a ready-made server-side condition. Its contents are the
 * SDK's business; what this module does is keep, drop and combine them, so a
 * marker object is enough to follow one through.
 */
function selection(choice: AttributeChoice, label = `${choice.name}: value`): AttributeSelection {
  return {
    choice,
    label,
    binLabel: 'value',
    condition: { marker: label } as unknown as AttributeFilter<MetaModel>,
  };
}

const criticality = attribute('criticality');
const owner = attribute('owner');

describe('FilterStore selections', () => {
  let store: FilterStore;
  beforeEach(() => {
    store = new FilterStore();
  });

  it('starts empty and inactive', () => {
    expect(store.get().attributes).toEqual([]);
    expect(store.isActive).toBe(false);
  });

  it('keeps selections on different attributes side by side', () => {
    store.select(selection(criticality));
    store.select(selection(owner));
    expect(store.get().attributes).toHaveLength(2);
  });

  it('moves rather than adds when the same attribute is picked again', () => {
    // A value cannot be in two buckets at once, so a second pick on the same
    // attribute must replace the first instead of contradicting it.
    store.select(selection(criticality, 'Criticality: high'));
    store.select(selection(criticality, 'Criticality: low'));

    expect(store.get().attributes).toHaveLength(1);
    expect(store.get().attributes[0]?.label).toBe('Criticality: low');
  });

  it('drops only the named attribute on deselect', () => {
    store.select(selection(criticality));
    store.select(selection(owner));
    store.deselect(criticality);

    expect(store.get().attributes.map((s) => s.choice.definitionId)).toEqual(['owner']);
  });

  it('treats the same definition id under a different category as a different attribute', () => {
    const other = attribute('criticality', 'other-category');
    store.select(selection(criticality));
    store.select(selection(other));
    expect(store.get().attributes).toHaveLength(2);
  });
});

describe('FilterStore type', () => {
  it('counts as active on its own', () => {
    const store = new FilterStore();
    store.setType({ id: 'Application' } as unknown as ObjectType);
    expect(store.isActive).toBe(true);
  });

  it('removes the key entirely when cleared, rather than leaving it undefined', () => {
    const store = new FilterStore();
    store.setType({ id: 'Application' } as unknown as ObjectType);
    store.setType(undefined);

    expect('type' in store.get()).toBe(false);
    expect(store.isActive).toBe(false);
  });
});

describe('FilterStore subscribers', () => {
  it('notifies on every change and stops once unsubscribed', () => {
    const store = new FilterStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.select(selection(criticality));
    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.select(selection(owner));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('FilterStore.prune', () => {
  it('drops selections the current type cannot match, and names them', () => {
    // An attribute filter addresses one type's schema. Carried onto a type
    // without that attribute it matches nothing, so the view empties and reads
    // as broken rather than as filtered.
    const store = new FilterStore();
    store.select(selection(criticality, 'Criticality: high'));
    store.select(selection(owner, 'Owner: platform'));

    const dropped = store.prune((choice) => choice.definitionId !== 'criticality');

    expect(dropped).toEqual(['Criticality: high']);
    expect(store.get().attributes.map((s) => s.choice.definitionId)).toEqual(['owner']);
  });

  it('says nothing and notifies nobody when everything still applies', () => {
    const store = new FilterStore();
    store.select(selection(criticality));
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.prune(() => true)).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('FilterStore.restore', () => {
  it('tolerates a snapshot with no attributes at all', () => {
    // Saved analyses predate the field; restoring one must not leave
    // `attributes` undefined for every reader downstream.
    const store = new FilterStore();
    store.restore({} as never);
    expect(store.get().attributes).toEqual([]);
  });
});

describe('scopeFor', () => {
  const store = () => {
    const s = new FilterStore();
    s.select(selection(criticality, 'a'));
    s.select(selection(owner, 'b'));
    return s;
  };

  it('is undefined when nothing is selected', () => {
    expect(scopeFor(new FilterStore().get())).toBeUndefined();
  });

  it('passes a lone condition through rather than wrapping it', () => {
    const s = new FilterStore();
    s.select(selection(criticality, 'a'));
    expect(scopeFor(s.get())).toEqual({ marker: 'a' });
  });

  it('combines several with and', () => {
    expect(scopeFor(store().get())).toEqual({ and: [{ marker: 'a' }, { marker: 'b' }] });
  });

  it('drops the excluded attribute, so a chart keeps every bar of its own', () => {
    // Filtering a chart by one of its own values would collapse it to a single
    // bar, while selections on other attributes must still apply.
    expect(scopeFor(store().get(), criticality)).toEqual({ marker: 'b' });
  });
});

describe('scopeExcluding', () => {
  it('drops both axes of a two-axis chart', () => {
    const s = new FilterStore();
    s.select(selection(criticality, 'a'));
    s.select(selection(owner, 'b'));
    s.select(selection(attribute('cost'), 'c'));

    expect(scopeExcluding(s.get(), criticality, owner)).toEqual({ marker: 'c' });
    expect(scopeExcluding(s.get(), criticality, owner, attribute('cost'))).toBeUndefined();
  });
});

describe('selectionFor and isSameAttribute', () => {
  it('finds the selection on a given attribute', () => {
    const s = new FilterStore();
    s.select(selection(criticality, 'Criticality: high'));

    expect(selectionFor(s.get(), criticality)?.label).toBe('Criticality: high');
    expect(selectionFor(s.get(), owner)).toBeUndefined();
  });

  it('compares on category and definition together', () => {
    expect(isSameAttribute(criticality, attribute('criticality'))).toBe(true);
    expect(isSameAttribute(criticality, attribute('criticality', 'elsewhere'))).toBe(false);
    expect(isSameAttribute(criticality, owner)).toBe(false);
  });
});
