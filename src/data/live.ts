import { Subscription } from 'rxjs';
import type { Kg } from '../sdk/client';

export interface LiveHandlers {
  readonly onObjectChanged?: (id: string, name: string, type: string) => void;
  readonly onRelationChanged?: (source: string | undefined, target: string | undefined) => void;
}

/**
 * Subscribes to graph mutations pushed over the realtime endpoint.
 *
 * The SDK emits `CREATE_*` and `UPDATE_*` only — there is no delete event.
 * A view that must notice removals has to re-count, or read `kg.auditLogs()`,
 * which returns a snapshot of each deleted object as it was.
 */
export function watchGraph(kg: Kg, handlers: LiveHandlers): Subscription {
  const subscription = new Subscription();

  if (handlers.onObjectChanged) {
    const onObjectChanged = handlers.onObjectChanged;
    subscription.add(
      // Passing a filter (even an empty one) selects the overload that emits
      // updates as well as creations.
      kg.onObjectEvents({}).subscribe((event) => {
        onObjectChanged(
          event.object.id ?? '',
          event.object.name ?? '(unnamed)',
          event.object.type ?? 'unknown',
        );
      }),
    );
  }

  if (handlers.onRelationChanged) {
    const onRelationChanged = handlers.onRelationChanged;
    subscription.add(
      kg.onRelationEvents({}).subscribe((event) => {
        onRelationChanged(event.relation.source?.id, event.relation.target?.id);
      }),
    );
  }

  return subscription;
}
