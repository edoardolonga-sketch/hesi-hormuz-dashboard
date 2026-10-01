import { readFile, writeFile } from "node:fs/promises";

const CANDIDATES_FILE = new URL(
  "../data/brent-alfred-candidates.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-methodology-review.json",
  import.meta.url
);

const EXPECTED_SERIES_ID =
  "DCOILBRENTEU";

const EXPECTED_METHOD =
  "ALFRED_INITIAL_RELEASE_REALTIME_START_END_OF_DAY_UTC";

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

function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  return Number.isFinite(
    new Date(
      `${value}T00:00:00.000Z`
    ).getTime()
  );
}

function validTimestamp(value) {
  if (
    typeof value !== "string"
  ) {
    return false;
  }

  return Number.isFinite(
    new Date(value).getTime()
  );
}

function reviewCandidate(candidate) {
  const reasons = [];

  if (
    candidate.sourceId !==
    "brent_market"
  ) {
    reasons.push(
      "UNEXPECTED_SOURCE_ID"
    );
  }

  if (
    candidate.seriesId !==
    EXPECTED_SERIES_ID
  ) {
    reasons.push(
      "UNEXPECTED_SERIES_ID"
    );
  }

  if (
    !validDate(
      candidate.observationDate
    )
  ) {
    reasons.push(
      "INVALID_OBSERVATION_DATE"
    );
  }

  if (
    typeof candidate.value !== "number" ||
    !Number.isFinite(candidate.value) ||
    candidate.value <= 0
  ) {
    reasons.push(
      "INVALID_VALUE"
    );
  }

  if (
    !validTimestamp(
      candidate.availableAt
    )
  ) {
    reasons.push(
      "INVALID_AVAILABLE_AT"
    );
  }

  if (
    candidate.availableAtMethod !==
    EXPECTED_METHOD
  ) {
    reasons.push(
      "UNEXPECTED_AVAILABLE_AT_METHOD"
    );
  }

  const evidence =
    candidate.availableAtEvidence;

  if (
    !evidence ||
    typeof evidence !== "object"
  ) {
    reasons.push(
      "AVAILABLE_AT_EVIDENCE_MISSING"
    );
  } else {
    if (
      evidence.provider !==
      "Federal Reserve Bank of St. Louis FRED/ALFRED"
    ) {
      reasons.push(
        "UNEXPECTED_EVIDENCE_PROVIDER"
      );
    }

    if (
      evidence.endpoint !==
      "fred/series/observations"
    ) {
      reasons.push(
        "UNEXPECTED_EVIDENCE_ENDPOINT"
      );
    }

    if (
      Number(evidence.outputType) !== 4
    ) {
      reasons.push(
        "UNEXPECTED_OUTPUT_TYPE"
      );
    }

    if (
      !validDate(
        evidence.realtimeStart
      )
    ) {
      reasons.push(
        "INVALID_REALTIME_START"
      );
    }

    if (
      evidence.realtimeStart &&
      validTimestamp(
        candidate.availableAt
      )
    ) {
      const expectedAvailableAt =
        `${evidence.realtimeStart}T23:59:59.999Z`;

      if (
        candidate.availableAt !==
        expectedAvailableAt
      ) {
        reasons.push(
          "AVAILABLE_AT_METHOD_MISMATCH"
        );
      }
    }
  }

  if (
    validDate(
      candidate.observationDate
    ) &&
    validTimestamp(
      candidate.availableAt
    )
  ) {
    const observationTime =
      new Date(
        `${candidate.observationDate}T00:00:00.000Z`
      ).getTime();

    const availableTime =
      new Date(
        candidate.availableAt
      ).getTime();

    if (
      availableTime <
      observationTime
    ) {
      reasons.push(
        "AVAILABLE_AT_PRECEDES_OBSERVATION"
      );
    }
  }

  return {
    sourceId:
      candidate.sourceId ?? null,

    seriesId:
      candidate.seriesId ?? null,

    observationDate:
      candidate.observationDate ?? null,

    availableAt:
      candidate.availableAt ?? null,

    value:
      candidate.value ?? null,

    unit:
      candidate.unit ?? null,

    frequency:
      candidate.frequency ?? null,

    availableAtEvidence:
      candidate.availableAtEvidence ?? null,

    availableAtMethod:
      candidate.availableAtMethod ?? null,

    passesMethodChecks:
      reasons.length === 0,

    admissionStatus:
      reasons.length === 0
        ? "METHOD_CHECKS_PASSED_NOT_ADMITTED"
        : "METHOD_CHECKS_FAILED",

    reasons
  };
}

function countReasons(results) {
  const counts = {};

  for (const result of results) {
    for (
      const reason of result.reasons
    ) {
      counts[reason] =
        (counts[reason] || 0) + 1;
    }
  }

  return counts;
}

async function main() {
  const reviewTimestamp =
    new Date().toISOString();

  const input =
    await readJson(
      CANDIDATES_FILE,
      "brent-alfred-candidates.json"
    );

  if (
    !Array.isArray(
      input.candidates
    )
  ) {
    throw new Error(
      "ALFRED candidates array is missing."
    );
  }

  const results =
    input.candidates.map(
      reviewCandidate
    );

  const passed =
    results.filter(
      (result) =>
        result.passesMethodChecks
    );

  const failed =
    results.filter(
      (result) =>
        !result.passesMethodChecks
    );

  const output = {
    schemaVersion: "1.1",

    status:
      failed.length === 0
        ? "METHOD_CHECKS_PASSED_REVIEW_STILL_REQUIRED"
        : "METHOD_CHECKS_PARTIAL_PASS_REVIEW_REQUIRED",

    reviewTimestamp,

    sourceDataset:
      "brent-alfred-candidates.json",

    seriesId:
      EXPECTED_SERIES_ID,

    reviewedMethod:
      EXPECTED_METHOD,

    methodologyDecision: {
      automatedChecksPassedForAll:
        failed.length === 0,

      automatedChecksPassedForEligibleSubset:
        passed.length > 0,

      humanMethodologicalApproval:
        false,

      admissionAuthorized:
        false,

      rationale:
        "Records passing the automated methodology checks are retained as reviewed candidates only. Automated consistency checks do not constitute scientific approval or authorize historical admission."
    },

    summary: {
      evaluated:
        results.length,

      passedMethodChecks:
        passed.length,

      failedMethodChecks:
        failed.length,

      reviewedCandidatesNotAdmitted:
        passed.length,

      admittedObservations:
        0,

      reasonCounts:
        countReasons(failed)
    },

    reviewedCandidates:
      passed,

    failedObservations:
      failed,

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
      "reviewedCandidates contains observations that passed the automated consistency checks but are not admitted observations.",
      "The ALFRED realtime_start evidence and conservative end-of-day UTC AvailableAt convention are retained with each reviewed candidate.",
      "The anomalous observation whose AvailableAt precedes its observationDate remains excluded from the reviewed-candidate subset.",
      "No failed observation is corrected, shifted or reconstructed automatically.",
      "Human methodological approval remains false.",
      "No observation is written to historical-observations.json by this script.",
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
    "ALFRED Brent methodology review"
  );

  console.log(
    "-------------------------------"
  );

  console.log(
    `Evaluated: ${results.length}`
  );

  console.log(
    `Passed method checks: ${passed.length}`
  );

  console.log(
    `Failed method checks: ${failed.length}`
  );

  console.log(
    `Reviewed candidates not admitted: ${passed.length}`
  );

  console.log(
    "Admitted observations: 0"
  );

  console.log(
    "Human methodological approval: NO"
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
    "ALFRED methodology review failed:"
  );

  console.error(error);

  process.exit(1);
});
