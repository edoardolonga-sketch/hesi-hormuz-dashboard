import { readFile, writeFile } from "node:fs/promises";

const HISTORICAL_PROBE_FILE = new URL(
  "../data/cftc-historical-probe.json",
  import.meta.url
);

const METHODOLOGY_DECISION_FILE = new URL(
  "../data/cftc-human-methodology-decision.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/cftc-historical-release-evidence.json",
  import.meta.url
);

const EXPECTED_SOURCE_ID = "cftc_cot";

const EXPECTED_SERIES_ID =
  "CFTC_WTI_PHYSICAL_MANAGED_MONEY";

const EXPECTED_MARKET_CODE = "067651";

/*
 * Official CFTC sources.
 *
 * IMPORTANT:
 * These pages are evidence sources only.
 * This script does not infer historical release dates
 * from the normal Tuesday -> Friday schedule.
 */
const RELEASE_SCHEDULE_URL =
  "https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm";

const SPECIAL_ANNOUNCEMENTS_URL =
  "https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalSpecialAnnouncements/index.htm";

/*
 * The policy approved by human methodological review
 * permits an AvailableAt only when an actual historical
 * release date is supported by official CFTC evidence.
 *
 * Therefore this script is deliberately conservative:
 *
 * 1. It DOES NOT assign observationDate + 3 days.
 * 2. It DOES NOT assume every report was released Friday.
 * 3. It DOES NOT manufacture timestamps.
 * 4. It DOES NOT admit observations.
 *
 * It only builds an evidence-review artifact.
 */

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isIsoDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const parsed =
    Date.parse(`${value}T00:00:00.000Z`);

  return Number.isFinite(parsed);
}

async function readJson(url, label) {
  let text;

  try {
    text = await readFile(url, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read ${label}: ${error.message}`
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error.message}`
    );
  }
}

async function fetchOfficialPage(url, label) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "hesi-hormuz-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `${label} request failed: ` +
      `${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();

  assert(
    text.length > 0,
    `${label} returned empty content.`
  );

  return {
    url,
    retrieved: true,
    byteLength:
      Buffer.byteLength(text, "utf8"),
    text
  };
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<\/div>/gi, " ")
    .replace(/<\/li>/gi, " ")
    .replace(/<\/tr>/gi, " ")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function monthName(dateString) {
  const date =
    new Date(`${dateString}T00:00:00.000Z`);

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "long",
      timeZone: "UTC"
    }
  ).format(date);
}

function dateSearchTokens(dateString) {
  const [
    year,
    month,
    day
  ] = dateString
    .split("-")
    .map(Number);

  const monthLong =
    monthName(dateString);

  const monthShort =
    monthLong.slice(0, 3);

  return [
    `${monthLong} ${day}, ${year}`,
    `${monthLong} ${String(day).padStart(2, "0")}, ${year}`,
    `${monthShort} ${day}, ${year}`,
    `${monthShort} ${String(day).padStart(2, "0")}, ${year}`,
    `${month}/${day}/${year}`,
    `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`
  ];
}

function pageMentionsObservationDate(
  normalizedPageText,
  observationDate
) {
  const lower =
    normalizedPageText.toLowerCase();

  return dateSearchTokens(
    observationDate
  ).some(
    (token) =>
      lower.includes(
        token.toLowerCase()
      )
  );
}

/*
 * A page merely mentioning an observation/report date
 * is NOT sufficient evidence to assign AvailableAt.
 *
 * We intentionally classify such a row only as
 * OFFICIAL_PAGE_DATE_MENTION_FOUND.
 *
 * Actual DOCUMENTED status requires a separately
 * established release-date mapping.
 */
function buildInitialEvidenceRecord(
  observation,
  scheduleText,
  specialText
) {
  const observationDate =
    observation.observationDate;

  const scheduleMention =
    pageMentionsObservationDate(
      scheduleText,
      observationDate
    );

  const specialMention =
    pageMentionsObservationDate(
      specialText,
      observationDate
    );

  let evidenceStatus =
    "UNRESOLVED";

  if (
    scheduleMention ||
    specialMention
  ) {
    evidenceStatus =
      "OFFICIAL_PAGE_DATE_MENTION_FOUND";
  }

  return {
    sourceId:
      observation.sourceId,

    seriesId:
      observation.seriesId,

    marketCode:
      observation.marketCode,

    observationDate,

    value:
      observation.value,

    existingAvailableAt:
      observation.availableAt,

    evidenceStatus,

    documentedReleaseDate:
      null,

    proposedAvailableAt:
      null,

    officialEvidence: {
      releaseSchedulePageMentionsObservationDate:
        scheduleMention,

      specialAnnouncementsPageMentionsObservationDate:
        specialMention,

      actualReleaseDateEstablished:
        false,

      publicationTimeEstablishedForThisRecord:
        false
    },

    admissionStatus:
      "NOT_AUTHORIZED"
  };
}

async function main() {
  const analysisTimestamp =
    new Date().toISOString();

  /*
   * Load approved methodology and extracted CFTC values.
   */
  const methodology =
    await readJson(
      METHODOLOGY_DECISION_FILE,
      "CFTC human methodology decision"
    );

  const historicalProbe =
    await readJson(
      HISTORICAL_PROBE_FILE,
      "CFTC historical probe"
    );

  /*
   * Validate human methodological decision.
   *
   * Methodology schema 1.1 uses the conservative
   * documented-release-date end-of-day UTC convention.
   *
   * This evidence-analysis stage still does NOT assign
   * AvailableAt. It only identifies evidence requiring
   * deeper review.
   */
  assert(
    methodology.schemaVersion === "1.1",
    "Unexpected CFTC methodology schema version."
  );

  assert(
    methodology.decisionType ===
      "CFTC_HISTORICAL_AVAILABLE_AT_METHODOLOGY",
    "Unexpected CFTC methodology decision type."
  );

  assert(
    methodology.decisionRecorded === true,
    "CFTC methodology decision is not recorded."
  );

  assert(
    methodology.approved === true,
    "CFTC AvailableAt methodology is not approved."
  );

  assert(
    methodology.admissionAuthorized === false,
    "This analysis requires CFTC admission to remain unauthorized."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.releaseDateEvidenceRequired === true,
    "Documented CFTC release-date evidence is not required by methodology."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.availableAtConvention ===
      "DOCUMENTED_RELEASE_DATE_CONSERVATIVE_END_OF_DAY_UTC",
    "Unexpected documented-release AvailableAt convention."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.availableAtTimeUtc ===
      "23:59:59.999Z",
    "Unexpected conservative AvailableAt time."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.actualIntradayReleaseTimeRequired ===
      false,
    "Methodology unexpectedly requires exact historical intraday release time."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.availableAtRepresentsActualPublicationTimestamp ===
      false,
    "Conservative AvailableAt must not be represented as the actual CFTC publication timestamp."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.availableAt === null,
    "Undocumented CFTC releases must retain null AvailableAt."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.observationDatePlusThreeDaysAssumed ===
      false,
    "Methodology unexpectedly permits observationDate + 3 days."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.normalFridayReleaseAssumed ===
      false,
    "Methodology unexpectedly assumes normal Friday release."
  );

  /*
   * Validate historical extraction artifact.
   */
  assert(
    historicalProbe.schemaVersion === "1.4",
    "CFTC historical probe must be schema 1.4."
  );

  assert(
    historicalProbe.status ===
      "CFTC_HISTORICAL_VALUES_PREPARED_AVAILABLE_AT_PENDING_NOT_ADMITTED",
    "Unexpected CFTC historical probe status."
  );

  assert(
    Array.isArray(
      historicalProbe.observations
    ),
    "CFTC historical observations are missing."
  );

  assert(
    historicalProbe.observations.length > 0,
    "No CFTC historical observations available for evidence analysis."
  );

  /*
   * Revalidate every extracted record before using it.
   */
  const seenDates =
    new Set();

  for (
    const observation of
    historicalProbe.observations
  ) {
    assert(
      observation.sourceId ===
        EXPECTED_SOURCE_ID,
      `Unexpected sourceId on ${observation.observationDate}.`
    );

    assert(
      observation.seriesId ===
        EXPECTED_SERIES_ID,
      `Unexpected seriesId on ${observation.observationDate}.`
    );

    assert(
      observation.marketCode ===
        EXPECTED_MARKET_CODE,
      `Unexpected market code on ${observation.observationDate}.`
    );

    assert(
      isIsoDate(
        observation.observationDate
      ),
      `Invalid observation date: ${observation.observationDate}`
    );

    assert(
      Number.isFinite(
        observation.value
      ),
      `Invalid CFTC value on ${observation.observationDate}.`
    );

    assert(
      observation.availableAt === null,
      `Historical AvailableAt unexpectedly exists on ${observation.observationDate}.`
    );

    assert(
      !seenDates.has(
        observation.observationDate
      ),
      `Duplicate CFTC observation date: ${observation.observationDate}`
    );

    seenDates.add(
      observation.observationDate
    );
  }

  /*
   * Retrieve official evidence pages.
   */
  const releaseSchedule =
    await fetchOfficialPage(
      RELEASE_SCHEDULE_URL,
      "CFTC release schedule"
    );

  const specialAnnouncements =
    await fetchOfficialPage(
      SPECIAL_ANNOUNCEMENTS_URL,
      "CFTC historical special announcements"
    );

  const normalizedSchedule =
    normalizeText(
      releaseSchedule.text
    );

  const normalizedSpecial =
    normalizeText(
      specialAnnouncements.text
    );

  /*
   * Basic identity checks.
   *
   * We do not require exact wording beyond broad
   * CFTC/COT identity because website presentation
   * may change without changing the evidence itself.
   */
  assert(
    normalizedSchedule
      .toLowerCase()
      .includes("commitments of traders"),
    "CFTC release schedule page identity check failed."
  );

  assert(
    normalizedSpecial
      .toLowerCase()
      .includes("commitments of traders"),
    "CFTC special announcements page identity check failed."
  );

  /*
   * Build evidence classifications.
   *
   * NOTE:
   * A date mention on an official page is NOT enough
   * to establish an actual release date.
   *
   * Therefore no record becomes DOCUMENTED merely
   * because its observation date appears on a page.
   */
  const records =
    historicalProbe.observations.map(
      (observation) =>
        buildInitialEvidenceRecord(
          observation,
          normalizedSchedule,
          normalizedSpecial
        )
    );

  const documented =
    records.filter(
      (record) =>
        record.evidenceStatus ===
        "DOCUMENTED"
    );

  const officialPageMentions =
    records.filter(
      (record) =>
        record.evidenceStatus ===
        "OFFICIAL_PAGE_DATE_MENTION_FOUND"
    );

  const unresolved =
    records.filter(
      (record) =>
        record.evidenceStatus ===
        "UNRESOLVED"
    );

  /*
   * Safety invariant:
   *
   * This first evidence pass must not manufacture
   * any AvailableAt timestamps.
   */
  const recordsWithProposedAvailableAt =
    records.filter(
      (record) =>
        record.proposedAvailableAt !==
        null
    );

  assert(
    recordsWithProposedAvailableAt.length ===
      0,
    "Evidence analysis unexpectedly assigned historical AvailableAt."
  );

  const output = {
    schemaVersion:
      "1.0",

    status:
      "CFTC_HISTORICAL_RELEASE_EVIDENCE_ANALYZED_NOT_ADMITTED",

    analysisTimestamp,

    methodology: {
      decisionSchemaVersion:
        methodology.schemaVersion,

      decisionRecorded:
        true,

      approved:
        true,

      admissionAuthorized:
        false,

      documentedReleaseEvidenceRequired:
        true,

      availableAtConvention:
        "DOCUMENTED_RELEASE_DATE_CONSERVATIVE_END_OF_DAY_UTC",

      actualIntradayReleaseTimeRequired:
        false,

      conservativeAvailableAtIsActualPublicationTimestamp:
        false,

      undocumentedAvailableAtRemainsNull:
        true,

      observationDatePlusThreeDaysAssumed:
        false,

      normalFridayReleaseAssumed:
        false
    },

    targetSeries: {
      sourceId:
        EXPECTED_SOURCE_ID,

      seriesId:
        EXPECTED_SERIES_ID,

      marketCode:
        EXPECTED_MARKET_CODE,

      reportType:
        "Disaggregated Futures Only",

      metric:
        "Managed Money Long minus Managed Money Short"
    },

    officialEvidenceSources: {
      releaseSchedule: {
        url:
          RELEASE_SCHEDULE_URL,

        retrieved:
          releaseSchedule.retrieved,

        byteLength:
          releaseSchedule.byteLength
      },

      historicalSpecialAnnouncements: {
        url:
          SPECIAL_ANNOUNCEMENTS_URL,

        retrieved:
          specialAnnouncements.retrieved,

        byteLength:
          specialAnnouncements.byteLength
      }
    },

    summary: {
      observationsAnalyzed:
        records.length,

      documentedReleaseDates:
        documented.length,

      officialPageDateMentions:
        officialPageMentions.length,

      unresolved:
        unresolved.length,

      proposedAvailableAtCount:
        recordsWithProposedAvailableAt.length,

      observationsAdmitted:
        0
    },

    records,

    interpretation: {
      officialPageDateMentionIsNotReleaseProof:
        true,

      documentedStatusRequiresActualReleaseDateEvidence:
        true,

      exactHistoricalIntradayTimeNotRequiredByMethodology:
        true,

      conservativeEndOfDayConventionAppliedAtThisStage:
        false,

      noHistoricalTimestampFabricated:
        true,

      currentPassPurpose:
        "Identify which 2025 CFTC observations have official-page evidence requiring deeper release-date verification. This pass does not assign AvailableAt."
    },

    safeguards: {
      historicalStoreModified:
        false,

      historicalDatasetModified:
        false,

      pointInTimeDatasetModified:
        false,

      calibrationDatasetModified:
        false,

      calibrationPerformed:
        false,

      modelWeightsModified:
        false,

      thresholdsModified:
        false,

      forecastModelTrained:
        false,

      officialHesiModified:
        false,

      dashboardOfficialHesiModified:
        false
    },

    nextResearchQuestion:
      "For records with official CFTC page evidence, establish the documented historical release date from official evidence before applying the conservative end-of-day UTC AvailableAt convention."
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
    "CFTC historical release evidence analysis"
  );

  console.log(
    "-----------------------------------------"
  );

  console.log(
    `Observations analyzed: ${records.length}`
  );

  console.log(
    `Documented release dates: ${documented.length}`
  );

  console.log(
    `Official-page date mentions: ${officialPageMentions.length}`
  );

  console.log(
    `Unresolved: ${unresolved.length}`
  );

  console.log(
    "Historical AvailableAt assigned: 0"
  );

  console.log(
    "Historical observations admitted: 0"
  );

  console.log(
    "Point-in-time dataset modified: NO"
  );

  console.log(
    "Calibration performed: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "CFTC historical release evidence analysis failed:"
  );

  console.error(error);

  process.exit(1);
});
