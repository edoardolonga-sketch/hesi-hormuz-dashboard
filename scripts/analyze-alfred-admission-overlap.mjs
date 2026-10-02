import { readFile, writeFile } from "node:fs/promises";

const STAGING_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

const HISTORICAL_FILE = new URL(
  "../data/historical-observations.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-admission-overlap.json",
  import.meta.url
);

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function observationKey(observation) {
  return (
    `${observation.sourceId}|` +
    `${observation.seriesId}|` +
    `${observation.observationDate}`
  );
}

function sameValue(a, b) {
  return (
    typeof a === "number" &&
    typeof b === "number" &&
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    a === b
  );
}

async function main() {
  const staging = await readJson(
    STAGING_FILE,
    "brent-alfred-admission-ready.json"
  );

  const historical = await readJson(
    HISTORICAL_FILE,
    "historical-observations.json"
  );

  requireCondition(
    staging.status ===
      "METHODOLOGY_APPROVED_PREPARED_NOT_ADMITTED",
    "ALFRED staging is not in the expected prepared state."
  );

  requireCondition(
    staging.methodologyState?.decisionRecorded === true,
    "ALFRED methodology decision has not been recorded."
  );

  requireCondition(
    staging.methodologyState
      ?.humanMethodologicalApproval === true,
    "ALFRED methodology has not been approved."
  );

  requireCondition(
    staging.methodologyState?.admissionAuthorized === false,
    "ALFRED staging unexpectedly authorizes admission."
  );

  requireCondition(
    Array.isArray(staging.preparedCandidates),
    "Prepared ALFRED candidates array is missing."
  );

  requireCondition(
    staging.preparedCandidates.length === 3939,
    "Unexpected number of prepared ALFRED candidates."
  );

  requireCondition(
    Array.isArray(historical.observations),
    "Historical observations array is missing."
  );

  const historicalByKey = new Map();

  for (const observation of historical.observations) {
    const key = observationKey(observation);

    requireCondition(
      !historicalByKey.has(key),
      `Historical store already contains duplicate key: ${key}`
    );

    historicalByKey.set(key, observation);
  }

  const candidateKeys = new Set();

  const overlaps = [];

  for (const candidate of staging.preparedCandidates) {
    requireCondition(
      candidate.sourceId === "brent_market",
      "Unexpected ALFRED candidate sourceId."
    );

    requireCondition(
      candidate.seriesId === "DCOILBRENTEU",
      "Unexpected ALFRED candidate seriesId."
    );

    requireCondition(
      candidate.preparationStatus ===
        "READY_FOR_EXPLICIT_ADMISSION_DECISION",
      "ALFRED candidate is not in the expected preparation state."
    );

    requireCondition(
      typeof candidate.observationDate === "string",
      "ALFRED candidate has no observationDate."
    );

    requireCondition(
      typeof candidate.availableAt === "string",
      "ALFRED candidate has no AvailableAt."
    );

    requireCondition(
      typeof candidate.value === "number" &&
        Number.isFinite(candidate.value),
      "ALFRED candidate has an invalid value."
    );

    const observationDateMs =
      Date.parse(candidate.observationDate);

    const availableAtMs =
      Date.parse(candidate.availableAt);

    requireCondition(
      Number.isFinite(observationDateMs),
      `Invalid ALFRED observationDate: ${candidate.observationDate}`
    );

    requireCondition(
      Number.isFinite(availableAtMs),
      `Invalid ALFRED AvailableAt: ${candidate.availableAt}`
    );

    requireCondition(
      availableAtMs >= observationDateMs,
      `ALFRED AvailableAt precedes observationDate: ${candidate.observationDate}`
    );

    const key = observationKey(candidate);

    requireCondition(
      !candidateKeys.has(key),
      `Duplicate ALFRED candidate key: ${key}`
    );

    candidateKeys.add(key);

    const existing = historicalByKey.get(key);

    if (!existing) {
      continue;
    }

    overlaps.push({
      key,
      sourceId: candidate.sourceId,
      seriesId: candidate.seriesId,
      observationDate: candidate.observationDate,

      candidate: {
        value: candidate.value,
        availableAt: candidate.availableAt,
        unit: candidate.unit ?? null,
        frequency: candidate.frequency ?? null
      },

      historical: {
        value: existing.value,
        availableAt: existing.availableAt,
        unit: existing.unit ?? null,
        frequency: existing.frequency ?? null
      },

      comparison: {
        sameValue: sameValue(
          candidate.value,
          existing.value
        ),

        sameAvailableAt:
          candidate.availableAt ===
          existing.availableAt
      }
    });
  }

  const exactOverlaps =
    overlaps.filter(
      (item) =>
        item.comparison.sameValue === true &&
        item.comparison.sameAvailableAt === true
    );

  const valueMatchesAvailableAtDiffers =
    overlaps.filter(
      (item) =>
        item.comparison.sameValue === true &&
        item.comparison.sameAvailableAt === false
    );

  const valueConflicts =
    overlaps.filter(
      (item) =>
        item.comparison.sameValue === false
    );

  const nonOverlappingCandidates =
    staging.preparedCandidates.length -
    overlaps.length;

  const output = {
    schemaVersion: "1.0",

    status:
      "ANALYZED_NOT_ADMITTED",

    analysisTimestamp:
      new Date().toISOString(),

    sourceStaging:
      "brent-alfred-admission-ready.json",

    sourceHistoricalStore:
      "historical-observations.json",

    summary: {
      preparedCandidates:
        staging.preparedCandidates.length,

      existingHistoricalObservations:
        historical.observations.length,

      overlappingKeys:
        overlaps.length,

      exactOverlaps:
        exactOverlaps.length,

      valueMatchesAvailableAtDiffers:
        valueMatchesAvailableAtDiffers.length,

      valueConflicts:
        valueConflicts.length,

      nonOverlappingCandidates
    },

    overlapPolicy: {
      key:
        "sourceId|seriesId|observationDate",

      automaticOverwriteAllowed:
        false,

      automaticReplacementAllowed:
        false,

      automaticAdmissionAllowed:
        false,

      conflictingRecordsRequireReview:
        true
    },

    overlaps,

    safeguards: {
      admissionAuthorized:
        false,

      historicalStoreModified:
        false,

      calibrationDatasetModified:
        false,

      officialHesiModified:
        false
    },

    notes: [
      "This artifact only analyzes overlap between prepared ALFRED Brent candidates and the admitted historical observation store.",
      "No candidate is admitted by this script.",
      "No existing historical observation is overwritten or replaced.",
      "Overlap is determined using sourceId, seriesId and observationDate.",
      "A matching observation date with a different AvailableAt is not treated as an exact duplicate.",
      "Any value conflict must remain unresolved until explicitly reviewed.",
      "Official HESI is not modified by this analysis."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "ALFRED historical admission overlap analysis"
  );

  console.log(
    "--------------------------------------------"
  );

  console.log(
    `Prepared candidates: ${output.summary.preparedCandidates}`
  );

  console.log(
    `Existing historical observations: ${output.summary.existingHistoricalObservations}`
  );

  console.log(
    `Overlapping keys: ${output.summary.overlappingKeys}`
  );

  console.log(
    `Exact overlaps: ${output.summary.exactOverlaps}`
  );

  console.log(
    `Same value / different AvailableAt: ${output.summary.valueMatchesAvailableAtDiffers}`
  );

  console.log(
    `Value conflicts: ${output.summary.valueConflicts}`
  );

  console.log(
    `Non-overlapping candidates: ${output.summary.nonOverlappingCandidates}`
  );

  console.log(
    "Automatic overwrite: NO"
  );

  console.log(
    "Admission authorized: NO"
  );

  console.log(
    "Historical store modified: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "ALFRED historical admission overlap analysis failed:"
  );

  console.error(error);

  process.exit(1);
});
