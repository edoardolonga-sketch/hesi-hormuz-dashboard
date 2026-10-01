import { readFile, writeFile } from "node:fs/promises";

const QUARANTINE_FILE = new URL(
  "../data/brent-historical-quarantine.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/historical-admission-report.json",
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

function validTimestamp(value) {
  if (!value) {
    return false;
  }

  return Number.isFinite(
    new Date(value).getTime()
  );
}

function evaluateObservation(observation) {
  const reasons = [];

  if (!observation.sourceId) {
    reasons.push("MISSING_SOURCE_ID");
  }

  if (!observation.seriesId) {
    reasons.push("MISSING_SERIES_ID");
  }

  if (!observation.observationDate) {
    reasons.push("MISSING_OBSERVATION_DATE");
  }

  if (
    typeof observation.value !== "number" ||
    !Number.isFinite(observation.value)
  ) {
    reasons.push("INVALID_VALUE");
  }

  if (!observation.availableAt) {
    reasons.push(
      "AVAILABLE_AT_NOT_VERIFIED"
    );
  } else if (
    !validTimestamp(observation.availableAt)
  ) {
    reasons.push(
      "INVALID_AVAILABLE_AT"
    );
  }

  /*
   * IMPORTANT:
   *
   * Even a syntactically valid AvailableAt is
   * not enough for historical admission.
   *
   * A historical observation must also carry
   * explicit evidence describing where the
   * availability timestamp came from.
   */

  if (!observation.availableAtEvidence) {
    reasons.push(
      "AVAILABLE_AT_EVIDENCE_MISSING"
    );
  }

  if (!observation.availableAtMethod) {
    reasons.push(
      "AVAILABLE_AT_METHOD_MISSING"
    );
  }

  const admitted =
    reasons.length === 0;

  return {
    sourceId:
      observation.sourceId ?? null,

    seriesId:
      observation.seriesId ?? null,

    observationDate:
      observation.observationDate ?? null,

    value:
      observation.value ?? null,

    availableAt:
      observation.availableAt ?? null,

    admitted,

    reasons
  };
}

async function main() {
  const validationTimestamp =
    new Date().toISOString();

  const quarantine = await readJson(
    QUARANTINE_FILE,
    "brent-historical-quarantine.json"
  );

  if (!Array.isArray(quarantine.observations)) {
    throw new Error(
      "Quarantine observations array is missing."
    );
  }

  const results =
    quarantine.observations.map(
      evaluateObservation
    );

  const admitted =
    results.filter(
      (result) => result.admitted
    );

  const rejected =
    results.filter(
      (result) => !result.admitted
    );

  const reasonCounts = {};

  for (const result of rejected) {
    for (const reason of result.reasons) {
      reasonCounts[reason] =
        (reasonCounts[reason] || 0) + 1;
    }
  }

  const output = {
    schemaVersion: "1.0",

    status:
      admitted.length === 0
        ? "NO_HISTORICAL_OBSERVATIONS_ADMITTED"
        : "HISTORICAL_ADMISSION_REQUIRES_REVIEW",

    validationTimestamp,

    sourceDataset:
      "brent-historical-quarantine.json",

    policy:
      "Historical observations may be admitted only when AvailableAt is present, valid, and supported by explicit evidence and a documented availability method. observationDate alone is never sufficient.",

    summary: {
      evaluated:
        results.length,

      admitted:
        admitted.length,

      rejected:
        rejected.length,

      reasonCounts
    },

    admittedObservations:
      admitted,

    promotion: {
      automaticAdmission:
        false,

      historicalStoreUpdated:
        false,

      calibrationDatasetUpdated:
        false,

      officialHesiUpdated:
        false
    },

    notes: [
      "This report is an admission gate, not a historical-data reconstruction mechanism.",
      "A valid price and observationDate do not establish historical availability.",
      "Missing AvailableAt must never be replaced automatically with observationDate.",
      "Historical availability evidence must be documented before admission.",
      "Passing this structural gate does not by itself authorize automatic promotion; methodological review remains required."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(
      output,
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    "Historical admission validation"
  );

  console.log(
    "-------------------------------"
  );

  console.log(
    `Evaluated: ${results.length}`
  );

  console.log(
    `Admitted: ${admitted.length}`
  );

  console.log(
    `Rejected: ${rejected.length}`
  );

  console.log(
    "Automatic admission: DISABLED"
  );

  console.log(
    "Historical store modified: NO"
  );

  console.log(
    "Calibration dataset modified: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "Historical admission validation failed:"
  );

  console.error(error);

  process.exit(1);
});
