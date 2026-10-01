import { readFile, writeFile } from "node:fs/promises";

const REVIEW_FILE = new URL(
  "../data/brent-alfred-methodology-review.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

async function readJson(file, label) {
  const raw =
    await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Invalid JSON in ${label}`
    );
  }
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(
      new Date(value).getTime()
    )
  );
}

function key(observation) {
  return (
    `${observation.sourceId}|` +
    `${observation.seriesId}|` +
    `${observation.observationDate}`
  );
}

async function main() {
  const preparationTimestamp =
    new Date().toISOString();

  const review =
    await readJson(
      REVIEW_FILE,
      "brent-alfred-methodology-review.json"
    );

  if (
    !Array.isArray(
      review.reviewedCandidates
    )
  ) {
    throw new Error(
      "reviewedCandidates array is missing."
    );
  }

  /*
   * Safety gate:
   *
   * This script is allowed to PREPARE records,
   * but it must never interpret preparation as
   * authorization for admission.
   */

  if (
    review.methodologyDecision
      ?.humanMethodologicalApproval !== false
  ) {
    throw new Error(
      "Unexpected human methodological approval state."
    );
  }

  if (
    review.methodologyDecision
      ?.admissionAuthorized !== false
  ) {
    throw new Error(
      "Unexpected admission authorization state."
    );
  }

  const seen =
    new Set();

  const ready = [];

  for (
    const candidate of
    review.reviewedCandidates
  ) {
    if (
      candidate.passesMethodChecks !==
      true
    ) {
      throw new Error(
        "Reviewed candidate does not pass method checks."
      );
    }

    if (
      candidate.admissionStatus !==
      "METHOD_CHECKS_PASSED_NOT_ADMITTED"
    ) {
      throw new Error(
        "Unexpected candidate admission status."
      );
    }

    if (
      !candidate.sourceId ||
      !candidate.seriesId ||
      !candidate.observationDate ||
      !validTimestamp(
        candidate.availableAt
      ) ||
      typeof candidate.value !==
        "number" ||
      !Number.isFinite(
        candidate.value
      )
    ) {
      throw new Error(
        "Invalid reviewed candidate."
      );
    }

    const observationKey =
      key(candidate);

    if (
      seen.has(
        observationKey
      )
    ) {
      throw new Error(
        `Duplicate reviewed candidate: ${observationKey}`
      );
    }

    seen.add(
      observationKey
    );

    ready.push({
      sourceId:
        candidate.sourceId,

      seriesId:
        candidate.seriesId,

      observationDate:
        candidate.observationDate,

      availableAt:
        candidate.availableAt,

      value:
        candidate.value,

      unit:
        candidate.unit,

      frequency:
        candidate.frequency,

      availableAtEvidence:
        candidate.availableAtEvidence,

      availableAtMethod:
        candidate.availableAtMethod,

      preparationStatus:
        "READY_FOR_EXPLICIT_ADMISSION_DECISION"
    });
  }

  ready.sort(
    (a, b) =>
      new Date(
        a.observationDate
      ).getTime() -
      new Date(
        b.observationDate
      ).getTime()
  );

  const output = {
    schemaVersion: "1.0",

    status:
      "PREPARED_NOT_ADMITTED",

    preparationTimestamp,

    sourceDataset:
      "brent-alfred-methodology-review.json",

    summary: {
      reviewedCandidates:
        review.reviewedCandidates.length,

      preparedCandidates:
        ready.length,

      admittedObservations:
        0
    },

    methodologyState: {
      humanMethodologicalApproval:
        false,

      admissionAuthorized:
        false
    },

    preparedCandidates:
      ready,

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
      "This file is an admission-ready staging artifact only.",
      "Prepared candidates passed the automated structural and methodology-consistency checks.",
      "Preparation does not constitute methodological approval.",
      "Preparation does not authorize historical admission.",
      "No observation is written to historical-observations.json by this script.",
      "The excluded ALFRED anomaly is not present in this staging artifact.",
      "Calibration and official HESI remain unchanged."
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
    "Prepare ALFRED Brent admission staging"
  );

  console.log(
    "-------------------------------------"
  );

  console.log(
    `Reviewed candidates: ${review.reviewedCandidates.length}`
  );

  console.log(
    `Prepared candidates: ${ready.length}`
  );

  console.log(
    "Admitted observations: 0"
  );

  console.log(
    "Admission authorized: NO"
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
    "ALFRED admission preparation failed:"
  );

  console.error(error);

  process.exit(1);
});
