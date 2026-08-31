import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { ObjectType, UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { busy } from '../ui/busy';
import { must } from '../ui/dom';
import { labelFor } from '../sdk/metamodel';
import { mountSearch, type SearchBox } from '../ui/search';
import type { FilterStore } from '../data/filter';
import { HOP_LABELS, hopColor, token } from './theme';

const MAX_HOP = 3;
/** Label treatment by hop distance — depth reads as weight, not as absence. */
const LABEL_INK = ['--text-primary', '--text-primary', '--text-secondary', '--text-muted'];
const LABEL_SIZE = [13.5, 13, 12, 11];
const LABEL_CHARS = [28, 24, 20, 16];
const NODE_RADIUS = 11;
const TAP_SLOP = 8;

interface Node extends SimulationNodeDatum {
  id: UUID;
  name: string;
  type: string;
  hop: number;
  expanded: boolean;
}

interface Link extends SimulationLinkDatum<Node> {
  /** The relation's own id, needed to reference it from a saved view. */
  id: UUID;
  role: string;
  /** Relation type, e.g. `BDCore.DependencyRelation`. */
  type: string;
}

export interface EgoNetwork {
  /** Where the filter chips belong: a floating panel over the canvas. */
  readonly filterHost: HTMLElement;
  focusType(type: ObjectType): Promise<void>;
  focusObject(id: UUID, name: string, type: string): Promise<void>;
  destroy(): void;
}

/**
 * Touch-driven ego network.
 *
 * Colour encodes hop distance from the focus — an ordinal ramp of one hue, so
 * the reading is "how far from here", not "which of ten types". Type is carried
 * by the label instead: ten categorical hues would fail every CVD gate in a
 * view where any two nodes can end up adjacent.
 */
export function mountEgoNetwork(
  container: HTMLElement,
  session: Session,
  filters: FilterStore,
): EgoNetwork {
  container.innerHTML = `
    <div class="graph">
      <canvas></canvas>
      <div class="finder"></div>
      <div class="graph-chips"></div>
      <div class="hud">
        <button type="button" data-act="recenter">Recentre</button>
        <span class="status"></span>
      </div>
      <div class="legend" aria-label="Distance from focus"></div>
    </div>
  `;

  const canvas = must(container.querySelector('canvas'), 'ego-network: canvas');
  const status = must(container.querySelector<HTMLElement>('.status'), 'ego-network: status');
  const legend = must(container.querySelector<HTMLElement>('.legend'), 'ego-network: legend');
  const context = must(canvas.getContext('2d'), 'ego-network: 2d context');

  legend.replaceChildren(
    ...HOP_LABELS.map((label, hop) => {
      const item = document.createElement('span');
      item.innerHTML = `<i style="background:${hopColor(hop)}"></i>${label}`;
      return item;
    }),
  );

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  container.querySelector('.graph')?.append(tip);

  const finder: SearchBox = mountSearch(
    must(container.querySelector<HTMLElement>('.finder'), 'ego-network: finder'),
    session,
    (hit) => void focusObject(hit.id, hit.name, hit.type).catch(report),
    { placeholder: 'Search for a starting point…', filters },
  );

  let nodes: Node[] = [];
  let links: Link[] = [];
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  const linkForce = forceLink<Node, Link>([])
    .id((node) => node.id)
    .distance(130)
    .strength(0.3);

  const simulation: Simulation<Node, Link> = forceSimulation<Node>([])
    .force('charge', forceManyBody<Node>().strength(-460))
    .force('collide', forceCollide<Node>(NODE_RADIUS * 3.2))
    .force('link', linkForce)
    .on('tick', draw);

  const resize = new ResizeObserver(() => {
    const ratio = globalThis.devicePixelRatio || 1;
    canvas.width = container.clientWidth * ratio;
    canvas.height = container.clientHeight * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    simulation.force('center', forceCenter(container.clientWidth / 2, container.clientHeight / 2));
    simulation.alpha(0.4).restart();
  });
  resize.observe(container);

  // ── rendering ────────────────────────────────────────────────────────

  function draw(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);

    context.lineWidth = 2 / scale;
    context.strokeStyle = token('--border');
    for (const link of links) {
      const source = link.source as Node;
      const target = link.target as Node;
      if (source.x == null || target.x == null) continue;
      context.beginPath();
      context.moveTo(source.x, source.y ?? 0);
      context.lineTo(target.x, target.y ?? 0);
      context.stroke();
    }

    const surface = token('--surface-1');
    for (const node of nodes) {
      if (node.x == null || node.y == null) continue;
      context.beginPath();
      context.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
      context.fillStyle = hopColor(node.hop);
      context.fill();
      // 2px surface ring keeps overlapping nodes readable as separate marks.
      context.lineWidth = 2 / scale;
      context.strokeStyle = surface;
      context.stroke();
    }

    drawLabels(surface);

    context.restore();
    status.textContent = `${nodes.length} objects · ${links.length} relations`;
  }

  /**
   * Direct labels for every node, with depth carried by weight rather than by
   * presence — a 3-hop node is still named, just quieter.
   *
   * Two things keep them readable where a force layout puts nodes close
   * together: a surface-coloured halo behind each label, and a collision test
   * that drops a label rather than letting it overprint one already drawn.
   * Nudging them apart instead would detach them from their nodes. Labels are
   * drawn at a constant screen size, so zooming in resolves anything the
   * collision test had to drop; a tap always names the node outright.
   */
  function drawLabels(surface: string): void {
    context.textAlign = 'center';
    context.lineJoin = 'round';
    context.lineWidth = 3.5 / scale;
    context.strokeStyle = surface;

    const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const padding = 3 / scale;

    // Nearest the focus first, so the most relevant labels win a collision.
    for (const node of [...nodes].sort((a, b) => a.hop - b.hop)) {
      if (node.x == null || node.y == null) continue;

      const depth = Math.min(node.hop, 3);
      const size = LABEL_SIZE[depth]! / scale;
      context.font = `${node.hop === 0 ? 600 : 400} ${size}px -apple-system, system-ui, sans-serif`;

      const text = truncate(node.name, LABEL_CHARS[depth]!);
      const width = context.measureText(text).width;
      const y = node.y - NODE_RADIUS - 7 / scale;
      const box = {
        x1: node.x - width / 2 - padding,
        y1: y - size,
        x2: node.x + width / 2 + padding,
        y2: y + padding,
      };

      const collides = placed.some(
        (other) => box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1,
      );
      if (collides) continue;

      placed.push(box);
      context.fillStyle = token(LABEL_INK[depth]!);
      context.strokeText(text, node.x, y);
      context.fillText(text, node.x, y);
    }
  }

  // ── data ─────────────────────────────────────────────────────────────

  async function seed(type: ObjectType): Promise<void> {
    // One page of one is enough to pick a starting point; ordering by name
    // keeps the choice stable between sessions.
    const page = await busy.track(
      session.kg
        .getObjects({ filter: { types: [type], orderBy: { name: 'ASC' } }, selector: {} })
        .asPages({ pageSize: 1 })
        .getPage(0),
    );

    const first = page[0];
    if (!first?.id) return;

    nodes = [
      {
        id: first.id,
        name: first.name ?? '(unnamed)',
        type: first.type ?? type,
        hop: 0,
        expanded: false,
        x: container.clientWidth / 2,
        y: container.clientHeight / 2,
      },
    ];
    links = [];
    apply();
    await expand(nodes[0]!);
  }

  /** Seeds from a specific object rather than the first of a type. */
  async function focusObject(id: UUID, name: string, type: string): Promise<void> {
    nodes = [
      {
        id,
        name,
        type,
        hop: 0,
        expanded: false,
        x: container.clientWidth / 2,
        y: container.clientHeight / 2,
      },
    ];
    links = [];
    apply();
    await expand(nodes[0]!);
  }

  /**
   * Pulls every relation touching this node, in either direction.
   *
   * `directionHandling: 'normalized'` is what makes that true — with
   * `'original'` the query only returns relations where the given ids are the
   * source, so half of an ego network would be missing.
   */
  async function expand(node: Node): Promise<void> {
    if (node.expanded || node.hop >= MAX_HOP) return;
    node.expanded = true;
    let settled = false;
    busy.begin();
    try {

    // Lazy Result — nothing is requested until the generator is consumed.
    const relations = session.kg.getNeighboringRelationsOfObjects({
      filter: { sourceObjectIds: [node.id], directionHandling: 'normalized' },
      // Normalization rewrites each relation so it reads source→target, which
      // means the SDK needs `roleName`, `source` and `target` all selected. Omit
      // any one of them and it rejects the call outright.
      selector: { roleName: true, source: true, target: true, sourceRole: true, targetRole: true },
    });

    const byId = new Map(nodes.map((existing) => [existing.id, existing]));

    for await (const relation of relations.stream()) {
      const source = relation.source;
      const target = relation.target;
      if (!source?.id || !target?.id) continue;

      for (const endpoint of [source, target]) {
        if (!endpoint.id || byId.has(endpoint.id)) continue;
        const added: Node = {
          id: endpoint.id,
          name: endpoint.name ?? '(unnamed)',
          type: endpoint.type ?? 'unknown',
          hop: node.hop + 1,
          expanded: false,
          // Born near their parent so the layout settles instead of exploding.
          x: (node.x ?? 0) + (Math.random() - 0.5) * 60,
          y: (node.y ?? 0) + (Math.random() - 0.5) * 60,
        };
        byId.set(added.id, added);
        nodes.push(added);
      }

      const exists = links.some(
        (link) => linkId(link.source) === source.id && linkId(link.target) === target.id,
      );
      if (!exists) {
        links.push({
          id: relation.id,
          source: source.id,
          target: target.id,
          role: relation.sourceRole ?? '',
          type: relation.type,
        });
      }
    }
      settled = true;
    } finally {
      busy.end();
      // A failed expansion must stay retryable on the next tap.
      if (!settled) node.expanded = false;
      apply();
    }
  }

  function apply(): void {
    simulation.nodes(nodes);
    linkForce.links(links);
    simulation.alpha(0.7).restart();
  }

  // ── interaction ──────────────────────────────────────────────────────

  const pointers = new Map<number, { x: number; y: number }>();
  let dragging: Node | null = null;
  let downAt: { x: number; y: number } | null = null;
  let pinchStart: { distance: number; scale: number } | null = null;

  canvas.addEventListener('pointerdown', (event) => {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture fails when the pointer is not active (synthetic events, a
      // pointer already released). Dragging still works without it.
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2) {
      pinchStart = { distance: pointerDistance(), scale };
      dragging = null;
      return;
    }

    downAt = { x: event.clientX, y: event.clientY };
    dragging = hitTest(event);
    if (dragging) {
      dragging.fx = dragging.x;
      dragging.fy = dragging.y;
      simulation.alphaTarget(0.25).restart();
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinchStart && pointers.size === 2) {
      scale = clamp(pinchStart.scale * (pointerDistance() / pinchStart.distance), 0.35, 3.5);
      draw();
      return;
    }

    const point = toGraph(event);
    if (dragging) {
      dragging.fx = point.x;
      dragging.fy = point.y;
      return;
    }

    if (downAt) {
      offsetX += event.movementX;
      offsetY += event.movementY;
      draw();
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = null;

    const moved =
      downAt !== null &&
      Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > TAP_SLOP;

    if (dragging) {
      dragging.fx = null;
      dragging.fy = null;
      simulation.alphaTarget(0);
      if (!moved) void tap(dragging, event).catch(report);
      dragging = null;
    } else if (!moved) {
      tip.hidden = true;
    }

    downAt = null;
  });

  canvas.addEventListener('pointercancel', (event) => {
    pointers.delete(event.pointerId);
    pinchStart = null;
    dragging = null;
    downAt = null;
  });

  container.querySelector('[data-act="recenter"]')?.addEventListener('click', () => {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    simulation.alpha(0.5).restart();
  });

  async function tap(node: Node, event: PointerEvent): Promise<void> {
    const bounds = container.getBoundingClientRect();
    tip.innerHTML = `<strong>${escape(node.name)}</strong><em>${escape(labelFor(node.type))} · ${node.hop === 0 ? 'focus' : `${node.hop} hop${node.hop > 1 ? 's' : ''} away`}</em>`;
    tip.hidden = false;
    tip.style.left = `${Math.min(event.clientX - bounds.left + 16, bounds.width - 280)}px`;
    tip.style.top = `${event.clientY - bounds.top + 16}px`;
    await expand(node);
  }

  /** Expansion failures belong in the status line, not an unhandled rejection. */
  function report(error: unknown): void {
    status.textContent = error instanceof Error ? error.message : String(error);
  }

  function hitTest(event: PointerEvent): Node | null {
    const point = toGraph(event);
    // Hit target is larger than the mark, per touch sizing.
    const reach = (NODE_RADIUS + 10) / scale;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (!node || node.x == null || node.y == null) continue;
      if (Math.hypot(node.x - point.x, node.y - point.y) <= reach) return node;
    }
    return null;
  }

  function toGraph(event: PointerEvent): { x: number; y: number } {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - offsetX) / scale,
      y: (event.clientY - bounds.top - offsetY) / scale,
    };
  }

  function pointerDistance(): number {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1;
  }

  return {
    filterHost: must(container.querySelector<HTMLElement>('.graph-chips'), 'ego-network: chips'),

    focusType: (type) => seed(type).catch(report),
    focusObject: (id, name, type) => focusObject(id, name, type).catch(report),
    destroy(): void {
      finder.destroy();
      resize.disconnect();
      simulation.stop();
      container.replaceChildren();
    },
  };
}

function linkId(endpoint: Link['source']): string {
  return typeof endpoint === 'string' ? endpoint : String((endpoint as Node).id ?? '');
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escape(value: string): string {
  return value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}
