import { readFile, writeFile } from "node:fs/promises";

const ANALYSIS_FILE = new URL(
  "../data/brent-alfred-availability-analysis.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-methodology-evidence.json",
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

async function main() {
  const evidenceTimestamp =
    new Date().toISOString();

  const analysis =
    await readJson(
      ANALYSIS_FILE,
      "brent-alfred-availability-analysis.json"
    );

  const observationsAnalyzed =
    analysis.summary
      ?.observationsAnalyzed;

  const negativeLagCount =
    analysis.lagStatistics
      ?.negativeLagCount;

  const overSevenDayCount =
    analysis.lagStatistics
      ?.overSevenDayCount;

  if (
    observationsAnalyzed !== 3939
  ) {
    throw new Error(
      `Unexpected observation count: ${observationsAnalyzed}`
    );
  }

  if (
    negativeLagCount !== 0
  ) {
    throw new Error(
      "Negative lags detected in prepared candidate set."
    );
  }

  const output = {
    schemaVersion: "1.0",

    status:
      "DOCUMENTED_NOT_ADMITTED",

    evidenceTimestamp,

    subject:
      "ALFRED Brent historical availability methodology",

    seriesId:
      "DCOILBRENTEU",

    officialDocumentation: [
      {
        authority:
          "Federal Reserve Bank of St. Louis",

        document:
          "FRED API Real-Time Periods",

        url:
          "https://fred.stlouisfed.org/docs/api/fred/realtime_period.html",

        supportedInterpretation:
          "The real-time period represents when information was known and allows retrieval of information known as of a historical period."
      },
      {
        authority:
          "Federal Reserve Bank of St. Louis",

        document:
          "fred/series/observations",

        url:
          "https://fred.stlouisfed.org/docs/api/fred/series_observations.html",

        supportedInterpretation:
          "output_type=4 is documented as Observations, Initial Release Only."
      },
      {
        authority:
          "Federal Reserve Bank of St. Louis",

        document:
          "fred/series/vintagedates",

        url:
          "https://fred.stlouisfed.org/docs/api/fred/series_vintagedates.html",

        supportedInterpretation:
          "Vintage dates identify dates when series values were revised or new data values were released."
      }
    ],

    methodologyAssessment: {
      realtimeStartUse:
        "SUPPORTED_AT_DATE_LEVEL",

      initialReleaseQuery:
        "SUPPORTED",

      intradayAvailability:
        "NOT_ESTABLISHED",

      candidateAvailableAtConvention:
        "ALFRED realtime_start date converted conservatively to 23:59:59.999 UTC.",

      conventionType:
        "CONSERVATIVE_RESEARCH_CONVENTION_NOT_PROVIDER_TIMESTAMP",

      leakageInterpretation:
        "The candidate convention does not move information earlier than the ALFRED realtime_start date.",

      exactPublicationTimeClaimed:
        false
    },

    empiricalEvidence: {
      observationsAnalyzed,

      duplicateObservations:
        analysis.summary
          ?.duplicateObservations,

      earliestObservationDate:
        analysis.summary
          ?.earliestObservationDate,

      latestObservationDate:
        analysis.summary
          ?.latestObservationDate,

      minimumLagCalendarDays:
        analysis.lagStatistics
          ?.minimumCalendarDays,

      medianLagCalendarDays:
        analysis.lagStatistics
          ?.medianCalendarDays,

      meanLagCalendarDays:
        analysis.lagStatistics
          ?.meanCalendarDays,

      maximumLagCalendarDays:
        analysis.lagStatistics
          ?.maximumCalendarDays,

      negativeLagCount,

      overSevenDayCount,

      lagDistribution:
        analysis.lagDistribution
    },

    interpretation: {
      longLagsAutomaticallyInvalid:
        false,

      rationale:
        "A lag above seven calendar days is not by itself evidence of leakage or invalidity. The ALFRED realtime_start date is retained rather than shifted backward.",

      anomalousRecordPolicy:
        "Records failing temporal consistency checks remain excluded and are never corrected automatically."
    },

    methodologyDecision: {
      documentationSupport:
        true,

      automatedConsistencySupport:
        true,

      humanMethodologicalApproval:
        false,

      admissionAuthorized:
        false,

      reason:
        "Official documentation and empirical consistency support continued methodological review, but documentation alone does not authorize admission to the calibration dataset."
    },

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
      "This artifact records methodological evidence; it does not admit observations.",
      "ALFRED realtime_start is treated as date-level availability evidence.",
      "No intraday publication timestamp is inferred from ALFRED.",
      "The end-of-day UTC AvailableAt convention is intentionally conservative.",
      "Observed lags are retained exactly rather than normalized to an assumed publication schedule.",
      "The 738 observations above seven calendar days are not automatically rejected solely because of their lag.",
      "Human methodological approval remains false.",
      "Historical calibration and official HESI remain unchanged."
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
    "ALFRED methodology evidence"
  );

  console.log(
    "---------------------------"
  );

  console.log(
    `Observations documented: ${observationsAnalyzed}`
  );

  console.log(
    `Negative lags: ${negativeLagCount}`
  );

  console.log(
    `Lags > 7 days retained for review: ${overSevenDayCount}`
  );

  console.log(
    "Official documentation support: YES"
  );

  console.log(
    "Intraday availability established: NO"
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
    "ALFRED methodology evidence failed:"
  );

  console.error(error);

  process.exit(1);
});
