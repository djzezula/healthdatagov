import axios from "axios";
import { App } from "@tinyhttp/app";
import { logger } from "@tinyhttp/logger";
import ExcelJS from "exceljs";
import axiosCacheAdapter from "axios-cache-adapter";
const { setupCache } = axiosCacheAdapter;

const PORT = process.env.PORT || 5000;

const cache = setupCache({
  maxAge: 15 * 60 * 1000, // 15 minutes
});

const client = axios.create({ adapter: cache.adapter });

const app = new App();
app
  .use(logger())
  .get("/", async (req, res) => {
    res.send(
      `<!DOCTYPE html>
<html><body>
  <h1>COVID-19 Community Profile Report - powered by HealthData.gov</h1>
  <h2>Filtered by county</h2>
  <form action="/county-data">
    <fieldset>
      <legend>County data by FIPS codes</legend>
      <label for="fips_codes">FIPS Codes (comma separated):</label><br />
		<textarea id="fips_codes" name="fips" cols="80">${DENVER_AREA_FIPS_CODES.join()}</textarea><br />
      <input type="submit" />
    </fieldset>
  </form>
</body></html>`
    );
  })
  .get("/denver-transmission-categories", async (req, res) => {
    const reportWorkbook = await fetchLatestReportWorkbook();
    const result = getFilteredCountyData(
      reportWorkbook,
      DENVER_AREA_FIPS_CODES
    );

    res.json(result);
  })
  .get("/county-data", async (req, res) => {
    if (!req.query.fips) {
      return res.status(400).json({
        message:
          'Must specificy query param "fips" with comma delimited list of codes',
      });
    }
    const fipsCodes = req.query.fips
      .split(",")
      .map((codeString) => parseInt(codeString.trim(), 10));
    const reportWorkbook = await fetchLatestReportWorkbook();
    const result = getFilteredCountyData(reportWorkbook, fipsCodes);
    res.json(result);
  })
  .listen(PORT);

async function fetchLatestReportWorkbook() {
  const excelAttachmentUrls = await fetchExcelAttachmentUrls();
  const fileUrl = excelAttachmentUrls[0]; // latest report at index 0
  const reportWorkbook = await downloadWorkbook(fileUrl);
  return reportWorkbook;
}
async function fetchExcelAttachmentUrls() {
  const ARCHIVE_JSON_URL = "https://healthdata.gov/resource/6hii-ae4f.json";
  const response = await client.get(ARCHIVE_JSON_URL);
  const lastReportIndex = response.data.length - 1;
  const lastReport = response.data[lastReportIndex];
  const metaDataPublished = JSON.parse(lastReport.metadata_published);
  const reportAttachments = metaDataPublished.attachments;
  const excelAttachments = reportAttachments.filter(({ filename }) =>
    filename.endsWith(".xlsx")
  );
  const getDownloadUrl = ({ assetId, filename }) =>
    `https://beta.healthdata.gov/api/views/gqxm-d9w9/files/${assetId}?download=true&filename=${filename}`;
  return excelAttachments.map(getDownloadUrl);
}

async function downloadWorkbook(url) {
  const response = await client.request({
    url,
    method: "GET",
    responseType: "stream",
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(response.data);
  return workbook;
}

const DENVER_AREA_FIPS_CODES = [
  8031,
  8005,
  8001,
  8059,
  8035,
  8123,
  8069,
  8013,
  8014,
  8047,
  8093,
  8019,
];

function getFilteredCountyData(workbook, fipsCodes) {
  const reportDate = workbook.getWorksheet("User Notes").getRow(4).getCell("B")
    .value;
  const worksheet = workbook.getWorksheet("Counties");
  const columnFipsCode = worksheet.getColumn("B");
  const filteredRows = [];
  columnFipsCode.eachCell((cell, rowNumber) => {
    if (fipsCodes.includes(cell.value)) {
      filteredRows.push(rowNumber);
    }
  });
  const countyTransmissionCategories = filteredRows.map((rowNumber) => {
    const row = worksheet.getRow(rowNumber);
    const countyName = row.getCell("A").value;
    const fipsCode = row.getCell("B").value;
    const areaOfConcernCategory = row.getCell("AG").value;
    const communityTransmissionLevelLast7 = row.getCell("AI").value;
    const communityTransmissionLevelPrev7 = row.getCell("AJ").value;
    const casesLast7DaysNationalPercentage = row.getCell("O").value;
    const casesLast7Days = row.getCell("P").value;
    const positivityRateLast7Days = row.getCell("AK").value;
    const fullyVaccinatedNationalPercentage = row.getCell("CB").value;
    return {
      fipsCode,
      countyName,
      areaOfConcernCategory,
      communityTransmissionLevelLast7,
      communityTransmissionLevelPrev7,
      casesLast7DaysNationalPercentage,
      casesLast7Days,
      positivityRateLast7Days,
      fullyVaccinatedNationalPercentage,
    };
  });
  return {
    reportDate,
    countyTransmissionCategories,
  };
}
