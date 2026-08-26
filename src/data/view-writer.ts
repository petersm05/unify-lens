import { generateUUID, type UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Kg } from '../sdk/client';

export interface GraphNode {
  readonly id: UUID;
  readonly name: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
}

export interface GraphEdge {
  readonly id: UUID;
  readonly type: string;
  readonly sourceId: UUID;
  readonly targetId: UUID;
}

/** Unify's own box geometry, taken from views the product itself wrote. */
const BOX_WIDTH = 196;
const BOX_HEIGHT = 80;
/**
 * Screen pixels are far denser than diagram coordinates — at 1:1 a 196×80 box
 * would swallow its neighbours — so the force layout is spread on the way out.
 */
const SPREAD = 3.4;

/**
 * Saves the on-screen graph as a Unify view.
 *
 * The `content` schema is undocumented (`ViewDto.content` is typed `object`),
 * so this mirrors what the product writes: a map keyed by *diagram element* id
 * — a fresh id per shape — where each entry points at the semantic element
 * through `semanticsId`. Getting that indirection wrong produces a view that
 * saves cleanly and then renders empty.
 */
export async function saveGraphAsView(
  kg: Kg,
  params: {
    readonly name: string;
    readonly description?: string;
    readonly nodes: readonly GraphNode[];
    readonly edges: readonly GraphEdge[];
  },
): Promise<UUID> {
  const content: Record<string, object> = {};
  /** Semantic object id → the diagram shape that stands for it. */
  const shapeFor = new Map<UUID, UUID>();

  for (const node of params.nodes) {
    const shapeId = generateUUID();
    shapeFor.set(node.id, shapeId);

    content[shapeId] = {
      version: '1.0',
      id: shapeId,
      name: { en: node.name },
      typeName: bareType(node.type),
      metaModelTerm: metaModelTerm(node.type),
      parentId: null,
      semanticsId: node.id,
      style: { shape: { fill: [] }, sourceShape: { fill: [] }, targetShape: { fill: [] }, icons: [] },
      layout: {
        x: Math.round(node.x * SPREAD),
        y: Math.round(node.y * SPREAD),
        width: BOX_WIDTH,
        height: BOX_HEIGHT,
      },
      elementKind: 'diagram',
      graphicKind: 3,
      zOrder: 0,
    };
  }

  for (const edge of params.edges) {
    const sourceShape = shapeFor.get(edge.sourceId);
    const targetShape = shapeFor.get(edge.targetId);
    if (!sourceShape || !targetShape) continue;

    const linkId = generateUUID();

    content[linkId] = {
      version: '1.0',
      id: linkId,
      name: { en: '' },
      typeName: bareType(edge.type),
      metaModelTerm: metaModelTerm(edge.type),
      parentId: null,
      semanticsId: edge.id,
      sourceId: sourceShape,
      targetId: targetShape,
      sourcePointParentId: 'd0',
      targetPointParentId: 'd0',
      points: [],
      customLinkEndShapeTypes: {},
      style: {
        icons: [],
        shape: {
          fill: [],
          label: {
            positionOffset: [
              {
                linkFoldingStateId: {
                  linkId,
                  sourceId: sourceShape,
                  targetId: targetShape,
                  sourceCollapsed: false,
                  targetCollapsed: false,
                },
                positionOffset: { x: 0, y: 0 },
              },
            ],
          },
        },
        sourceShape: { fill: [] },
        targetShape: { fill: [] },
      },
      elementKind: 'diagram',
      graphicKind: 2,
      zOrder: 0,
    };
  }

  const viewId = generateUUID();

  const result = await kg.createView({
    id: viewId,
    name: params.name,
    ...(params.description ? { description: params.description } : {}),
    content,
    // Views written by the product carry empty strings here rather than a
    // template name; matching that keeps this view indistinguishable.
    kind: '',
    definition: '',
    referencedObjectIds: params.nodes.map((node) => node.id),
    referencedRelationIds: params.edges
      .filter((edge) => shapeFor.has(edge.sourceId) && shapeFor.has(edge.targetId))
      .map((edge) => edge.id),
  });

  if (!result.ok) {
    throw new Error(describe(result.val));
  }

  return viewId;
}

/** `'BDCore.Application'` → `'Application'`. */
function bareType(type: string): string {
  return type.includes('.') ? (type.split('.')[1] ?? type) : type;
}

/** `'BDCore.Application'` → `'BDCore:Application'` — a colon, not a dot. */
function metaModelTerm(type: string): string {
  return type.replace('.', ':');
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return `Could not save the view: ${JSON.stringify(error)}`;
}
