import axios from "axios";
import { App } from "@tinyhttp/app";
import { logger } from "@tinyhttp/logger";
import ExcelJS from "exceljs";

const PORT = process.env.PORT || 5000;

const app = new App();
app
  .use(logger())
  .get("/", async (req, res) => {
    const excelAttachmentUrls = await fetchExcelAttachmentUrls();
    const downloadLinks = excelAttachmentUrls.map(
      (url) => `<a href="${url}">${url}</a>`
    );
    res.send(downloadLinks.join("<br />\n"));
  })
  .get("/denver-transmission-categories", async (req, res) => {
    const excelAttachmentUrls = await fetchExcelAttachmentUrls();
    const fileUrl = excelAttachmentUrls[0]; // latest report at index 0
    const reportWorkbook = await downloadWorkbook(fileUrl);
    const result = getDenverTransmissionCategories(reportWorkbook);

    res.setHeader("Content-type", "application/json");
    res.send(result);
  })
  .listen(PORT);

async function fetchExcelAttachmentUrls() {
  const ARCHIVE_JSON_URL = "https://healthdata.gov/resource/6hii-ae4f.json";
  const response = await axios.get(ARCHIVE_JSON_URL);
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
  const response = await axios.request({
    url,
    method: "GET",
    responseType: "stream",
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(response.data);
  return workbook;
}

function getDenverTransmissionCategories(workbook) {
  const reportDate = workbook.getWorksheet("User Notes").getRow(4).getCell("B")
    .value;
  const worksheet = workbook.getWorksheet("Counties");
  const columnCBSA = worksheet.getColumn("D");
  const denverRows = [];
  columnCBSA.eachCell((cell, rowNumber) => {
    if (cell.value === "Denver-Aurora-Lakewood, CO") {
      denverRows.push(rowNumber);
    }
  });
  const countyTransmissionCategories = denverRows.map((rowNumber) => {
    const row = worksheet.getRow(rowNumber);
    const countyName = row.getCell("A").value;
    const areaOfConcernCategory = row.getCell("AG").value;
    const communityTransmissionLevelLast7 = row.getCell("AI").value;
    const communityTransmissionLevelPrev7 = row.getCell("AJ").value;
    return {
      countyName,
      areaOfConcernCategory,
      communityTransmissionLevelLast7,
      communityTransmissionLevelPrev7,
    };
  });
  return {
    reportDate,
    countyTransmissionCategories,
  };
}
