import { readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = new URL(
  "../data/cftc-historical-release-evidence.json",
  import.meta.url
);

const METHODOLOGY_FILE = new URL(
  "../data/cftc-human-methodology-decision.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/cftc-documented-releases.json",
  import.meta.url
);

const SPECIAL_ANNOUNCEMENTS_URL =
  "https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalSpecialAnnouncements/index.htm";

const EXPECTED_SOURCE_ID = "cftc_cot";
const EXPECTED_SERIES_ID =
  "CFTC_WTI_PHYSICAL_MANAGED_MONEY";
const EXPECTED_MARKET_CODE = "067651";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(url, label) {
  const text = await readFile(url, "utf8");

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error.message}`
    );
  }
}

async function fetchOfficialPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "hesi-hormuz-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `CFTC request failed: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();

  assert(
    html.length > 0,
    "CFTC special announcements page returned empty content."
  );

  return html;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-");
}

function normalizeHtml(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function isIsoDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  return Number.isFinite(
    Date.parse(`${value}T00:00:00.000Z`)
  );
}

function isoDateFromParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  const date = new Date(
    Date.UTC(y, m - 1, d)
  );

  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== m ||
    date.getUTCDate() !== d
  ) {
    return null;
  }

  return [
    String(y).padStart(4, "0"),
    String(m).padStart(2, "0"),
    String(d).padStart(2, "0")
  ].join("-");
}

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

function parseEnglishDate(text) {
  if (typeof text !== "string") {
    return null;
  }

  const match = text
    .trim()
    .match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i
    );

  if (!match) {
    return null;
  }

  const month =
    MONTHS[match[1].toLowerCase()];

  return isoDateFromParts(
    match[3],
    month,
    match[2]
  );
}

function englishDateVariants(isoDate) {
  assert(
    isIsoDate(isoDate),
    `Invalid ISO date: ${isoDate}`
  );

  const date =
    new Date(`${isoDate}T00:00:00.000Z`);

  const month =
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      timeZone: "UTC"
    }).format(date);

  const monthShort =
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: "UTC"
    }).format(date);

  const day = date.getUTCDate();
  const year = date.getUTCFullYear();

  return [
    `${month} ${day}, ${year}`,
    `${month} ${String(day).padStart(2, "0")}, ${year}`,
    `${monthShort} ${day}, ${year}`,
    `${monthShort} ${String(day).padStart(2, "0")}, ${year}`
  ];
}

function findContexts(
  text,
  observationDate,
  radius = 650
) {
  const lowerText = text.toLowerCase();

  const variants =
    englishDateVariants(observationDate);

  const contexts = [];

  for (const variant of variants) {
    const lowerVariant =
      variant.toLowerCase();

    let startIndex = 0;

    while (true) {
      const index =
        lowerText.indexOf(
          lowerVariant,
          startIndex
        );

      if (index === -1) {
        break;
      }

      const from =
        Math.max(0, index - radius);

      const to =
        Math.min(
          text.length,
          index +
            variant.length +
            radius
        );

      contexts.push(
        text
          .slice(from, to)
          .replace(/\s+/g, " ")
          .trim()
      );

      startIndex =
        index + lowerVariant.length;
    }
  }

  return [...new Set(contexts)];
}

/*
 * We only accept explicit linguistic evidence linking
 * a report/positions date to a release/publication date.
 *
 * Examples of concepts accepted:
 *
 *   "... report for September 30, 2025 ...
 *        will be released November 19, 2025 ..."
 *
 *   "... positions as of September 30, 2025 ...
 *        publication on November 19, 2025 ..."
 *
 * A nearby date by itself is NOT sufficient.
 */
function extractExplicitReleaseCandidates(
  context,
  observationDate
) {
  const observationVariants =
    englishDateVariants(
      observationDate
    );

  const observationPattern =
    observationVariants
      .map(escapeRegExp)
      .join("|");

  const monthPattern =
    "(January|February|March|April|May|June|July|August|September|October|November|December)";

  const releaseDatePattern =
    `${monthPattern}\\s+(\\d{1,2}),\\s+(20\\d{2})`;

  const patterns = [
    new RegExp(
      `(?:report|positions|data)[^.!?]{0,250}(?:${observationPattern})[^.!?]{0,350}(?:released|release|published|publication|publish)[^.!?]{0,120}(${releaseDatePattern})`,
      "ig"
    ),

    new RegExp(
      `(?:${observationPattern})[^.!?]{0,350}(?:released|release|published|publication|publish)[^.!?]{0,120}(${releaseDatePattern})`,
      "ig"
    ),

    new RegExp(
      `(?:released|release|published|publication|publish)[^.!?]{0,120}(${releaseDatePattern})[^.!?]{0,350}(?:${observationPattern})`,
      "ig"
    )
  ];

  const results = [];

  for (const pattern of patterns) {
    let match;

    while (
      (match = pattern.exec(context)) !==
      null
    ) {
      const matchedText =
        match[0]
          .replace(/\s+/g, " ")
          .trim();

      const dateMatches =
        [
          ...matchedText.matchAll(
            /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/gi
          )
        ];

      const parsedDates =
        dateMatches
          .map((item) =>
            parseEnglishDate(item[0])
          )
          .filter(Boolean);

      const releaseCandidates =
        parsedDates.filter(
          (date) =>
            date !== observationDate
        );

      for (
        const releaseDate of
        releaseCandidates
      ) {
        results.push({
          releaseDate,
          matchedText
        });
      }
    }
  }

  const unique = new Map();

  for (const result of results) {
    const key =
      `${result.releaseDate}|${result.matchedText}`;

    unique.set(key, result);
  }

  return [...unique.values()];
}

function escapeRegExp(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

/*
 * Converts 15:30 America/New_York to UTC without
 * hardcoding EST/EDT.
 *
 * Node's Intl implementation provides the timezone
 * offset for the requested historical date.
 */
function localNewYork1530ToUtc(
  isoDate
) {
  assert(
    isIsoDate(isoDate),
    `Invalid release date: ${isoDate}`
  );

  const [
    year,
    month,
    day
  ] = isoDate
    .split("-")
    .map(Number);

  /*
   * Start with a UTC approximation corresponding
   * to 15:30 local. Then determine what local
   * New York time that instant represents and
   * adjust by the difference.
   */
  let utcMillis =
    Date.UTC(
      year,
      month - 1,
      day,
      15,
      30,
      0,
      0
    );

  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }
    );

  for (let i = 0; i < 3; i += 1) {
    const parts =
      formatter.formatToParts(
        new Date(utcMillis)
      );

    const map =
      Object.fromEntries(
        parts.map(
          ({ type, value }) =>
            [type, value]
        )
      );

    const representedLocalAsUtc =
      Date.UTC(
        Number(map.year),
        Number(map.month) - 1,
        Number(map.day),
        Number(map.hour),
        Number(map.minute),
        Number(map.second)
      );

    const desiredLocalAsUtc =
      Date.UTC(
        year,
        month - 1,
        day,
        15,
        30,
        0
      );

    utcMillis +=
      desiredLocalAsUtc -
      representedLocalAsUtc;
  }

  const finalDate =
    new Date(utcMillis);

  const verificationParts =
    Object.fromEntries(
      formatter
        .formatToParts(finalDate)
        .map(
          ({ type, value }) =>
            [type, value]
        )
    );

  assert(
    Number(verificationParts.year) ===
      year &&
      Number(
        verificationParts.month
      ) === month &&
      Number(
        verificationParts.day
      ) === day &&
      Number(
        verificationParts.hour
      ) === 15 &&
      Number(
        verificationParts.minute
      ) === 30,
    `Timezone conversion verification failed for ${isoDate}.`
  );

  return finalDate.toISOString();
}

function resolveRecord(
  record,
  officialText
) {
  assert(
    record.evidenceStatus ===
      "OFFICIAL_PAGE_DATE_MENTION_FOUND",
    `Record ${record.observationDate} is not an evidence candidate.`
  );

  const contexts =
    findContexts(
      officialText,
      record.observationDate
    );

  const candidates = [];

  for (const context of contexts) {
    const extracted =
      extractExplicitReleaseCandidates(
        context,
        record.observationDate
      );

    for (const item of extracted) {
      candidates.push({
        ...item,
        context
      });
    }
  }

  const releaseDates =
    [
      ...new Set(
        candidates.map(
          (item) =>
            item.releaseDate
        )
      )
    ];

  /*
   * Conservative rule:
   *
   * Exactly one explicit release date must be
   * recoverable for automatic DOCUMENTED status.
   *
   * Zero = unresolved.
   * More than one = ambiguous, human review required.
   */
  if (releaseDates.length === 1) {
    const releaseDate =
      releaseDates[0];

    const proposedAvailableAt =
      localNewYork1530ToUtc(
        releaseDate
      );

    return {
      ...record,

      resolutionStatus:
        "DOCUMENTED_RELEASE_CANDIDATE",

      documentedReleaseDate:
        releaseDate,

      proposedAvailableAt,

      publicationTimeLocal:
        "15:30:00",

      publicationTimezone:
        "America/New_York",

      evidence: {
        officialSource:
          SPECIAL_ANNOUNCEMENTS_URL,

        contextsFound:
          contexts.length,

        explicitReleaseCandidates:
          candidates.length,

        uniqueReleaseDates:
          releaseDates,

        actualReleaseDateEstablished:
          true,

        requiresHumanReviewBeforeAdmission:
          true
      },

      matchedEvidence:
        candidates.map(
          (item) => ({
            releaseDate:
              item.releaseDate,
            matchedText:
              item.matchedText
          })
        ),

      admissionStatus:
        "NOT_AUTHORIZED"
    };
  }

  if (releaseDates.length > 1) {
    return {
      ...record,

      resolutionStatus:
        "AMBIGUOUS_OFFICIAL_EVIDENCE",

      documentedReleaseDate:
        null,

      proposedAvailableAt:
        null,

      evidence: {
        officialSource:
          SPECIAL_ANNOUNCEMENTS_URL,

        contextsFound:
          contexts.length,

        explicitReleaseCandidates:
          candidates.length,

        uniqueReleaseDates:
          releaseDates,

        actualReleaseDateEstablished:
          false,

        requiresHumanReviewBeforeAdmission:
          true
      },

      matchedEvidence:
        candidates.map(
          (item) => ({
            releaseDate:
              item.releaseDate,
            matchedText:
              item.matchedText
          })
        ),

      admissionStatus:
        "NOT_AUTHORIZED"
    };
  }

  return {
    ...record,

    resolutionStatus:
      "UNRESOLVED_AFTER_DEEP_REVIEW",

    documentedReleaseDate:
      null,

    proposedAvailableAt:
      null,

    evidence: {
      officialSource:
        SPECIAL_ANNOUNCEMENTS_URL,

      contextsFound:
        contexts.length,

      explicitReleaseCandidates:
        0,

      uniqueReleaseDates:
        [],

      actualReleaseDateEstablished:
        false,

      requiresHumanReviewBeforeAdmission:
        true
    },

    matchedEvidence:
      [],

    admissionStatus:
      "NOT_AUTHORIZED"
  };
}

async function main() {
  const analysisTimestamp =
    new Date().toISOString();

  const input =
    await readJson(
      INPUT_FILE,
      "CFTC historical release evidence"
    );

  const methodology =
    await readJson(
      METHODOLOGY_FILE,
      "CFTC methodology decision"
    );

  /*
   * Validate methodology gate.
   */
  assert(
    methodology.schemaVersion === "1.0",
    "Unexpected CFTC methodology schema version."
  );

  assert(
    methodology.approved === true,
    "CFTC AvailableAt methodology is not approved."
  );

  assert(
    methodology.admissionAuthorized === false,
    "Historical CFTC admission must remain unauthorized."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.releaseDateEvidenceRequired ===
      true,
    "Official release-date evidence is not required by methodology."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.availableAt === null,
    "Undocumented CFTC AvailableAt must remain null."
  );

  /*
   * Validate input artifact.
   */
  assert(
    input.schemaVersion === "1.0",
    "Unexpected release-evidence schema."
  );

  assert(
    input.status ===
      "CFTC_HISTORICAL_RELEASE_EVIDENCE_ANALYZED_NOT_ADMITTED",
    "Unexpected release-evidence status."
  );

  assert(
    input.summary
      ?.observationsAnalyzed === 52,
    "Expected 52 CFTC observations."
  );

  assert(
    input.summary
      ?.observationsAdmitted === 0,
    "Input artifact unexpectedly contains admitted observations."
  );

  assert(
    Array.isArray(input.records),
    "Input records missing."
  );

  /*
   * Revalidate identities and select ONLY the
   * candidates already discovered in the first pass.
   */
  for (const record of input.records) {
    assert(
      record.sourceId ===
        EXPECTED_SOURCE_ID,
      `Unexpected source on ${record.observationDate}.`
    );

    assert(
      record.seriesId ===
        EXPECTED_SERIES_ID,
      `Unexpected series on ${record.observationDate}.`
    );

    assert(
      record.marketCode ===
        EXPECTED_MARKET_CODE,
      `Unexpected market code on ${record.observationDate}.`
    );

    assert(
      isIsoDate(
        record.observationDate
      ),
      `Invalid observation date: ${record.observationDate}`
    );

    assert(
      record.existingAvailableAt ===
        null,
      `Historical AvailableAt already exists on ${record.observationDate}.`
    );

    assert(
      record.admissionStatus ===
        "NOT_AUTHORIZED",
      `Unexpected admission status on ${record.observationDate}.`
    );
  }

  const candidates =
    input.records.filter(
      (record) =>
        record.evidenceStatus ===
        "OFFICIAL_PAGE_DATE_MENTION_FOUND"
    );

  const untouchedUnresolved =
    input.records.filter(
      (record) =>
        record.evidenceStatus ===
        "UNRESOLVED"
    );

  assert(
    candidates.length ===
      input.summary
        .officialPageDateMentions,
    "Candidate count does not match prior evidence artifact."
  );

  assert(
    untouchedUnresolved.length ===
      input.summary.unresolved,
    "Unresolved count does not match prior evidence artifact."
  );

  /*
   * Retrieve the official CFTC special-announcement
   * history and perform deeper evidence extraction.
   */
  const officialHtml =
    await fetchOfficialPage(
      SPECIAL_ANNOUNCEMENTS_URL
    );

  const officialText =
    normalizeHtml(
      officialHtml
    );

  assert(
    officialText
      .toLowerCase()
      .includes(
        "commitments of traders"
      ),
    "Official CFTC page identity check failed."
  );

  const resolvedCandidates =
    candidates.map(
      (record) =>
        resolveRecord(
          record,
          officialText
        )
    );

  const documentedCandidates =
    resolvedCandidates.filter(
      (record) =>
        record.resolutionStatus ===
        "DOCUMENTED_RELEASE_CANDIDATE"
    );

  const ambiguous =
    resolvedCandidates.filter(
      (record) =>
        record.resolutionStatus ===
        "AMBIGUOUS_OFFICIAL_EVIDENCE"
    );

  const unresolvedAfterReview =
    resolvedCandidates.filter(
      (record) =>
        record.resolutionStatus ===
        "UNRESOLVED_AFTER_DEEP_REVIEW"
    );

  /*
   * Safety checks on automatically resolved candidates.
   */
  for (
    const record of
    documentedCandidates
  ) {
    assert(
      isIsoDate(
        record.documentedReleaseDate
      ),
      `Invalid documented release date on ${record.observationDate}.`
    );

    assert(
      typeof record.proposedAvailableAt ===
        "string" &&
        Number.isFinite(
          Date.parse(
            record.proposedAvailableAt
          )
        ),
      `Invalid proposed AvailableAt on ${record.observationDate}.`
    );

    assert(
      Date.parse(
        record.proposedAvailableAt
      ) >
        Date.parse(
          `${record.observationDate}T00:00:00.000Z`
        ),
      `Proposed AvailableAt does not follow observation date on ${record.observationDate}.`
    );

    assert(
      record.admissionStatus ===
        "NOT_AUTHORIZED",
      `Resolved candidate unexpectedly authorized for admission: ${record.observationDate}.`
    );
  }

  /*
   * The 35 records that did not have official-page
   * evidence in the first pass are deliberately NOT
   * reinterpreted here.
   */
  const untouchedRecords =
    untouchedUnresolved.map(
      (record) => ({
        ...record,

        resolutionStatus:
          "UNRESOLVED_NOT_REINTERPRETED",

        documentedReleaseDate:
          null,

        proposedAvailableAt:
          null,

        admissionStatus:
          "NOT_AUTHORIZED"
      })
    );

  const output = {
    schemaVersion:
      "1.0",

    status:
      "CFTC_DOCUMENTED_RELEASE_CANDIDATES_REVIEWED_NOT_ADMITTED",

    analysisTimestamp,

    methodology: {
      approved:
        true,

      admissionAuthorized:
        false,

      officialReleaseEvidenceRequired:
        true,

      publicationTimeLocal:
        "15:30:00",

      publicationTimezone:
        "America/New_York",

      timezoneAwareUtcConversion:
        true,

      syntheticHistoricalTimestampAllowed:
        false
    },

    targetSeries: {
      sourceId:
        EXPECTED_SOURCE_ID,

      seriesId:
        EXPECTED_SERIES_ID,

      marketCode:
        EXPECTED_MARKET_CODE
    },

    officialEvidenceSource: {
      url:
        SPECIAL_ANNOUNCEMENTS_URL,

      retrieved:
        true,

      byteLength:
        Buffer.byteLength(
          officialHtml,
          "utf8"
        )
    },

    summary: {
      totalHistoricalObservations:
        input.records.length,

      candidatesDeepReviewed:
        resolvedCandidates.length,

      documentedReleaseCandidates:
        documentedCandidates.length,

      ambiguousOfficialEvidence:
        ambiguous.length,

      unresolvedAfterDeepReview:
        unresolvedAfterReview.length,

      priorUnresolvedLeftUntouched:
        untouchedRecords.length,

      availableAtCandidatesProposed:
        documentedCandidates.length,

      observationsAdmitted:
        0
    },

    documentedCandidates,

    ambiguousCandidates:
      ambiguous,

    unresolvedCandidates:
      unresolvedAfterReview,

    priorUnresolvedRecords:
      untouchedRecords,

    interpretation: {
      documentedReleaseCandidateIsNotAdmission:
        true,

      humanReviewStillRequired:
        true,

      officialEvidenceRequired:
        true,

      normalFridayScheduleNotUsedAsHistoricalProof:
        true,

      observationDatePlusThreeDaysNotUsed:
        true,

      unresolvedRecordsRetainNullAvailableAt:
        true
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
      "Human-review each documented or ambiguous candidate against the quoted official CFTC evidence before authorizing any historical AvailableAt or admission."
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
    "CFTC documented release resolution"
  );

  console.log(
    "----------------------------------"
  );

  console.log(
    `Historical observations: ${input.records.length}`
  );

  console.log(
    `Candidates deep-reviewed: ${resolvedCandidates.length}`
  );

  console.log(
    `Documented release candidates: ${documentedCandidates.length}`
  );

  console.log(
    `Ambiguous official evidence: ${ambiguous.length}`
  );

  console.log(
    `Unresolved after deep review: ${unresolvedAfterReview.length}`
  );

  console.log(
    `Prior unresolved left untouched: ${untouchedRecords.length}`
  );

  console.log(
    `AvailableAt candidates proposed: ${documentedCandidates.length}`
  );

  console.log(
    "Historical observations admitted: 0"
  );

  console.log(
    "Historical store modified: NO"
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
    "CFTC documented release resolution failed:"
  );

  console.error(error);

  process.exit(1);
});
