// Trims a saved GTFS-realtime Vehicle Positions feed to a size worth keeping in the repo for the
// decoder tests. Whole top-level fields are copied byte for byte, so the result is the same
// protobuf TfNSW sent, with fewer vehicles. From apps/api:
//   npx tsx scripts/trim-vehicle-feed.ts <in.pb> <out.pb> [--keep id,id] [--sample 40] [--prior 10]
// --keep    trip ids that must stay (the services of a recorded plan)
// --sample  how many other vehicles to keep, in feed order
// --prior   how many vehicles still finishing their previous trip to keep as well

import { readFileSync, writeFileSync } from 'node:fs';

import { decodeVehiclePositions } from '../src/providers/tfnsw/gtfs-realtime';

const FEED_HEADER = 1;
const FEED_ENTITY = 2;

interface TopLevelField {
  number: number;
  bytes: Uint8Array;
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let scale = 1;
  let position = offset;
  for (;;) {
    const byte = bytes[position++];
    if (byte === undefined) throw new Error('The feed ends inside a number');
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return { value, next: position };
    scale *= 128;
  }
}

// GTFS-realtime's top level holds only the header and entities, both length-delimited.
function topLevelFields(feed: Uint8Array): TopLevelField[] {
  const fields: TopLevelField[] = [];
  let offset = 0;
  while (offset < feed.length) {
    const key = readVarint(feed, offset);
    if (key.value % 8 !== 2) throw new Error('Expected only length-delimited top-level fields');
    const length = readVarint(feed, key.next);
    const end = length.next + length.value;
    fields.push({ number: Math.floor(key.value / 8), bytes: feed.subarray(offset, end) });
    offset = end;
  }
  return fields;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error(
    'Usage: trim-vehicle-feed.ts <in.pb> <out.pb> [--keep id,id] [--sample n] [--prior n]',
  );
}
const keep = new Set((option('keep') ?? '').split(',').filter(Boolean));
let sampleLeft = Number(option('sample') ?? 40);
let priorLeft = Number(option('prior') ?? 10);

const fields = topLevelFields(readFileSync(inputPath));
const header = fields.find((field) => field.number === FEED_HEADER);
if (!header) throw new Error('The feed has no header');

const kept: Uint8Array[] = [header.bytes];
for (const field of fields) {
  if (field.number !== FEED_ENTITY) continue;
  // Decoded on its own with the header, so its trip id and flags read as they do in the full feed.
  const [fix] = decodeVehiclePositions(Buffer.concat([header.bytes, field.bytes])).fixes.values();
  const wanted = fix !== undefined && keep.has(fix.tripId);
  const prior = fix?.onPreviousTrip === true && priorLeft > 0;
  if (wanted || prior || sampleLeft > 0) {
    kept.push(field.bytes);
    if (wanted) keep.delete(fix.tripId);
    else if (prior) priorLeft -= 1;
    else sampleLeft -= 1;
  }
}
if (keep.size > 0) throw new Error(`Not in the feed: ${[...keep].join(', ')}`);

const trimmed = Buffer.concat(kept);
writeFileSync(outputPath, trimmed);
process.stdout.write(`${outputPath}: ${kept.length - 1} vehicles, ${trimmed.length} bytes\n`);
