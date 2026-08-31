import { describe, expect, it } from 'vitest';
import type { ObjectType, UUID } from '@bizzdesign/sdk-bundle/browser';
import { parsePath, RouteStack, ROOT, sameRoute, samePath, type Route } from './route';

const APPLICATION = 'BDCore.Application' as ObjectType;
const PROCESS = 'BDCore.Process' as ObjectType;

/** The SDK brands its ids, and a fixture is the one place that has to say so. */
const id = (value: string): UUID => value as UUID;

const attributes: Route = { at: 'attributes', type: APPLICATION };

describe('the stack', () => {
  it('starts at the population, with nothing above it', () => {
    const routes = new RouteStack();
    expect(routes.current).toEqual(ROOT);
    expect(routes.depth).toBe(1);
    expect(routes.parent).toBeUndefined();
  });

  it('names the screen above, which is what a back button is for', () => {
    const routes = new RouteStack();
    routes.push(attributes);
    routes.push({ at: 'network', type: APPLICATION });

    expect(routes.parent).toEqual(attributes);
  });

  it('refuses to stack the screen already on top', () => {
    const routes = new RouteStack();
    routes.push(attributes);
    // Two identical history entries mean a Back that appears to do nothing.
    routes.push({ at: 'attributes', type: APPLICATION });

    expect(routes.depth).toBe(2);
  });

  it('leaves the root in place, because there is nowhere above it', () => {
    const routes = new RouteStack();
    routes.pop();
    routes.pop();

    expect(routes.current).toEqual(ROOT);
    expect(routes.depth).toBe(1);
  });

  it('swaps a screen for its sibling without going deeper', () => {
    const routes = new RouteStack();
    routes.push(attributes);
    routes.replace({ at: 'attributes', type: PROCESS });

    expect(routes.depth).toBe(2);
    expect(routes.current).toEqual({ at: 'attributes', type: PROCESS });
    expect(routes.parent).toEqual(ROOT);
  });

  it('reports why it moved, so history is written the right way', () => {
    const routes = new RouteStack();
    const changes: string[] = [];
    routes.subscribe((_path, change) => changes.push(change));

    routes.push(attributes);
    routes.replace({ at: 'attributes', type: PROCESS });
    routes.pop();
    routes.restore([ROOT, attributes]);

    expect(changes).toEqual(['push', 'replace', 'pop', 'restore']);
  });

  it('stays silent when nothing actually changed', () => {
    const routes = new RouteStack();
    routes.push(attributes);

    let calls = 0;
    routes.subscribe(() => calls++);
    routes.push(attributes);
    routes.replace(attributes);

    expect(calls).toBe(0);
  });

  it('never restores an empty trail', () => {
    const routes = new RouteStack();
    routes.push(attributes);
    routes.restore([]);

    expect(routes.path).toEqual([ROOT]);
  });

  it('drops the whole trail on the way back to the root', () => {
    const routes = new RouteStack();
    routes.push(attributes);
    routes.push({
      at: 'network',
      focus: { id: id('a-1'), name: 'SAP', type: 'BDCore.Application' },
    });
    routes.popToRoot();

    expect(routes.path).toEqual([ROOT]);
  });

  it('stops listening once unsubscribed', () => {
    const routes = new RouteStack();
    let calls = 0;
    routes.subscribe(() => calls++)();
    routes.push(attributes);

    expect(calls).toBe(0);
  });
});

describe('route identity', () => {
  it('separates two screens of the same kind about different types', () => {
    expect(sameRoute(attributes, { at: 'attributes', type: PROCESS })).toBe(false);
    expect(sameRoute(attributes, { at: 'attributes', type: APPLICATION })).toBe(true);
  });

  it('separates two graphs centred on different objects', () => {
    const one: Route = { at: 'network', focus: { id: id('a-1'), name: 'One', type: 'T' } };
    const two: Route = { at: 'network', focus: { id: id('a-2'), name: 'Two', type: 'T' } };

    expect(sameRoute(one, two)).toBe(false);
    expect(sameRoute(one, { ...one })).toBe(true);
  });

  it('ignores a focus name, which is a label rather than an identity', () => {
    const one: Route = { at: 'network', focus: { id: id('a-1'), name: 'Old name', type: 'T' } };
    const two: Route = { at: 'network', focus: { id: id('a-1'), name: 'Renamed', type: 'T' } };

    expect(sameRoute(one, two)).toBe(true);
  });

  it('compares trails by length and by every step', () => {
    expect(samePath([ROOT, attributes], [ROOT, attributes])).toBe(true);
    expect(samePath([ROOT], [ROOT, attributes])).toBe(false);
    expect(samePath([ROOT, attributes], [ROOT, { at: 'attributes', type: PROCESS }])).toBe(false);
  });
});

describe('reading a trail out of a link', () => {
  it('keeps what parses and drops what does not', () => {
    // A link is untrusted input: it may have been written by a newer build or
    // hand-edited, and losing the depth it could not read beats losing the link.
    const path = parsePath([
      { at: 'population' },
      { at: 'attributes', type: 'BDCore.Application' },
      { at: 'somewhere-else' },
      { at: 'attributes' },
      null,
      'network',
    ]);

    expect(path).toEqual([ROOT, attributes]);
  });

  it('answers with nothing for anything that is not a list', () => {
    expect(parsePath(undefined)).toEqual([]);
    expect(parsePath({ at: 'population' })).toEqual([]);
    expect(parsePath('population')).toEqual([]);
  });

  it('puts the root under a trail that does not start at one', () => {
    // Nothing else can draw a back button for a screen with no level above it.
    expect(parsePath([{ at: 'attributes', type: 'BDCore.Application' }])).toEqual([
      ROOT,
      attributes,
    ]);
  });

  it('reads a graph focus, defaulting only the name', () => {
    expect(parsePath([{ at: 'network', focus: { id: id('a-1'), type: 'T' } }])).toEqual([
      ROOT,
      { at: 'network', focus: { id: id('a-1'), name: '', type: 'T' } },
    ]);
  });

  it('drops a focus with no identity rather than inventing one', () => {
    expect(parsePath([{ at: 'network', focus: { name: 'SAP' } }])).toEqual([
      ROOT,
      { at: 'network' },
    ]);
  });
});
