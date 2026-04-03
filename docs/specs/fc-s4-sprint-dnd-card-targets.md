# FC-S4: Sprint drag-and-drop fails when dropping onto existing cards

## Problem Statement

In the Sprint Kanban board, dragging a task card from one column and dropping it onto another card in a different column silently fails. The drop only registers when the card is dropped onto the empty space of the target column. This makes drag-and-drop unreliable — in a column with many cards, there may be no visible empty space to drop onto.

## Root Cause

`KanbanBoard.tsx:31-38` — `handleDragEnd` reads `over.id` and validates it against `VALID_STATUSES` (e.g., `'backlog'`, `'queued'`, `'active'`, `'done'`). Each column uses `useDroppable` with the status string as its ID, which is correct. However, each `TaskCard` uses `useSortable` from `@dnd-kit/sortable`, which makes each card also a drop target. When a card is dropped onto another card, `over.id` is the target card's UUID — not a status string. The UUID fails the `VALID_STATUSES.includes()` check, so the drop is silently ignored.

## Files to Change

| File                                                  | Change                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/sprint/KanbanBoard.tsx`  | Fix `handleDragEnd` to resolve the parent column status when `over.id` is a card UUID; add `DragOverlay` for visual feedback |
| `src/renderer/src/components/sprint/KanbanColumn.tsx` | Potentially pass column status as data attribute on droppable for lookup                                                     |
| `src/renderer/src/components/sprint/TaskCard.tsx`     | Attach column status as `useSortable` data so it's available in `handleDragEnd`                                              |

## Implementation Notes

### Approach: Attach column status to sortable data

The cleanest fix is to pass the column status through `useSortable`'s `data` property on each `TaskCard`:

```typescript
// TaskCard.tsx
const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
  id: task.id,
  data: { status: task.status } // ← attach column identity
})
```

Then in `handleDragEnd`:

```typescript
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event
  if (!over) return

  let destinationStatus: string
  if (VALID_STATUSES.includes(over.id as string)) {
    // Dropped on column empty space
    destinationStatus = over.id as string
  } else if (over.data?.current?.status) {
    // Dropped on a card — resolve to that card's column
    destinationStatus = over.data.current.status
  } else {
    return
  }

  const sourceId = active.id as string
  const sourceTask = tasks.find((t) => t.id === sourceId)
  if (!sourceTask || sourceTask.status === destinationStatus) return

  onMoveTask(sourceId, destinationStatus)
}
```

### Optional: DragOverlay

Add a `<DragOverlay>` component inside `<DndContext>` to render a styled card preview during drag instead of the browser's default ghost image. This is cosmetic but significantly improves the drag experience.

### Column highlight

Add visual feedback when a droppable column is being hovered during a drag. Use `@dnd-kit`'s `useDndMonitor` or the `isOver` property from `useDroppable` to apply a CSS highlight class.

## Success Criteria

1. Drag a card from Backlog and drop it onto a card in the Sprint column → card moves to Sprint
2. Drag a card from Sprint and drop it onto the empty space of Done → card moves to Done (existing behavior preserved)
3. Drag a card within the same column → no status change (reorder only, or no-op if reorder is not persisted)
4. Visual drag overlay shows during drag
5. Target column highlights when a card hovers over it
