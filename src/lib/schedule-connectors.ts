import { differenceInCalendarDays, parseISO } from "date-fns";
import { scheduleDuration, type PredecessorType, type ScheduleTask } from "./schedule";

export const SCHEDULE_ROW_HEIGHT = 58;

export function scheduleBarBounds(task: ScheduleTask, timelineStart: Date, dayWidth: number) {
  const left = differenceInCalendarDays(parseISO(task.start), timelineStart) * dayWidth + 2;
  return { left, right: left + Math.max(8, (scheduleDuration(task.start, task.due) + 1) * dayWidth - 4) };
}

export function dependencySides(type: PredecessorType) {
  return { source: type[0] === "F" ? "finish" : "start", target: type[1] === "F" ? "finish" : "start" } as const;
}

type Point = { x: number; y: number };
function roundedPath(points: Point[]) {
  let path = `M ${points[0]?.x} ${points[0]?.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1], corner = points[i], after = points[i + 1];
    if (!before || !corner || !after) continue;
    const incoming = Math.hypot(corner.x - before.x, corner.y - before.y);
    const outgoing = Math.hypot(after.x - corner.x, after.y - corner.y);
    if (!incoming || !outgoing) continue;
    const radius = Math.min(5, incoming / 2, outgoing / 2);
    const a = { x: corner.x + (before.x - corner.x) * radius / incoming, y: corner.y + (before.y - corner.y) * radius / incoming };
    const b = { x: corner.x + (after.x - corner.x) * radius / outgoing, y: corner.y + (after.y - corner.y) * radius / outgoing };
    path += ` L ${a.x} ${a.y} Q ${corner.x} ${corner.y} ${b.x} ${b.y}`;
  }
  const last = points.at(-1);
  return path + ` L ${last?.x} ${last?.y}`;
}

export function scheduleConnectors(tasks: ScheduleTask[], timelineStart: Date, dayWidth: number) {
  const rows = new Map(tasks.map((task, index) => [task.id, { task, index }]));
  return tasks.flatMap((task, index) => {
    const predecessor = task.predecessor;
    const previous = predecessor ? rows.get(predecessor.taskId) : undefined;
    if (!predecessor || !previous || previous.index === index) return [];
    const sides = dependencySides(predecessor.type);
    const sourceBounds = scheduleBarBounds(previous.task, timelineStart, dayWidth);
    const targetBounds = scheduleBarBounds(task, timelineStart, dayWidth);
    const source = { x: sides.source === "finish" ? sourceBounds.right : sourceBounds.left, y: previous.index * SCHEDULE_ROW_HEIGHT + 28 };
    const target = { x: sides.target === "finish" ? targetBounds.right : targetBounds.left, y: index * SCHEDULE_ROW_HEIGHT + 28 };
    const sourceDirection = sides.source === "finish" ? 1 : -1;
    const targetDirection = sides.target === "finish" ? 1 : -1;
    const sourceStub = Math.max(1, source.x + sourceDirection * 12);
    const targetStub = Math.max(1, target.x + targetDirection * 12);
    let points: Point[];
    if (sourceDirection === targetDirection) {
      const lane = sourceDirection === 1 ? Math.max(sourceStub, targetStub) : Math.min(sourceStub, targetStub);
      points = [source, { x: lane, y: source.y }, { x: lane, y: target.y }, target];
    } else if (sourceDirection * (targetStub - sourceStub) >= 0) {
      const lane = (sourceStub + targetStub) / 2;
      points = [source, { x: lane, y: source.y }, { x: lane, y: target.y }, target];
    } else {
      // Route through the empty row gutter when the bars overlap in time.
      const gutter = index * SCHEDULE_ROW_HEIGHT + (index > previous.index ? 4 : 54);
      points = [source, { x: sourceStub, y: source.y }, { x: sourceStub, y: gutter }, { x: targetStub, y: gutter }, { x: targetStub, y: target.y }, target];
    }
    return [{ id: task.id, type: predecessor.type, source, target, path: roundedPath(points), arrow: `M ${target.x + targetDirection * 5} ${target.y - 4} L ${target.x} ${target.y} L ${target.x + targetDirection * 5} ${target.y + 4}`, label: `${previous.task.title} → ${task.title} · ${predecessor.type}` }];
  });
}