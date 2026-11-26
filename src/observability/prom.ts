export type Sample = {
  name: string;
  labels: Record<string, string>;
  value: number;
};

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)(?:\s+\d+)?$/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;

export function parseSamples(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const match = LINE.exec(line);
    if (!match) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    samples.push({
      name: match[1],
      labels: parseLabels(match[2] ?? ''),
      value,
    });
  }
  return samples;
}

function parseLabels(body: string): Record<string, string> {
  const labels: Record<string, string> = {};
  LABEL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LABEL.exec(body)) !== null) {
    labels[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

export function sumNamed(samples: Sample[], name: string, route?: string): number {
  let total = 0;
  for (const sample of samples) {
    if (sample.name !== name) continue;
    if (route !== undefined && sample.labels.route !== route) continue;
    total += sample.value;
  }
  return total;
}

export function seriesCount(samples: Sample[], name: string): number {
  let count = 0;
  for (const sample of samples) {
    if (sample.name === name) count += 1;
  }
  return count;
}

export function aboveTopBucket(samples: Sample[], histogram: string, route: string): number {
  const count = sumNamed(samples, `${histogram}_count`, route);
  let top = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    if (sample.name !== `${histogram}_bucket`) continue;
    if (sample.labels.route !== route) continue;
    const le = sample.labels.le;
    if (!le || le === '+Inf') continue;
    const numeric = Number(le);
    if (Number.isFinite(numeric) && numeric > top) top = numeric;
  }
  if (!Number.isFinite(top)) return count;
  let covered = 0;
  for (const sample of samples) {
    if (sample.name !== `${histogram}_bucket`) continue;
    if (sample.labels.route !== route) continue;
    if (Number(sample.labels.le) === top) covered += sample.value;
  }
  return count - covered;
}

export function errorDelta(before: Sample[], after: Sample[], name: string): number {
  const totals = (samples: Sample[]) => {
    let total = 0;
    for (const sample of samples) {
      if (sample.name !== name) continue;
      if (!/^5\d\d$/.test(sample.labels.status ?? '')) continue;
      total += sample.value;
    }
    return total;
  };
  return totals(after) - totals(before);
}
