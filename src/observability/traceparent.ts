import { randomBytes } from 'node:crypto';

export type TraceParent = {
  traceId: string;
  parentId: string;
  header: string;
};

export function newTraceParent(): TraceParent {
  const traceId = randomBytes(16).toString('hex');
  const parentId = randomBytes(8).toString('hex');
  return {
    traceId,
    parentId,
    header: `00-${traceId}-${parentId}-01`,
  };
}
