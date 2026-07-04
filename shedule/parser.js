const axios = require('axios');
const cheerio = require('cheerio');

const dateCheck = '2026.06.08';      //  здесь передавать данные требуемой даты 
const groupId = 'А-03-23';           //  здесь передавать данные группы

let encodedId;

async function translateGroup(code) {
  const encoded = encodeURIComponent(code);
  const url = `https://ts.mpei.ru/api/search?term=${encoded}&type=group`;

  const { data } = await axios.get(url, {
    headers: {
      "accept": "application/json, text/plain, */*",
      "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://ts.mpei.ru/ruz/main"
    }
  });

  if (!Array.isArray(data) || data.length === 0){
    throw new Error('Группа не найдена');
  }

  encodedId = data[0].id;
  console.log(encodedId);
}

let currentDate;
let lessons = [];

async function parseSite() {
  const { data } = await axios.get(`https://mpei.ru/Education/timetable/Pages/table.aspx?groupoid=${encodedId}&start=${dateCheck}`);

  const $ = cheerio.load(data);

  $('tr').each((index, element) => {
    const row = $(element).closest('tr');
    const isDate = row.find('.mpei-galaktika-lessons-grid-date').length > 0;
    const isLesson = row.find('.mpei-galaktika-lessons-grid-day').length > 0;

    if (!isDate && !isLesson) {
      return
    }

    if (row.find('.mpei-galaktika-lessons-grid-date').length > 0){
      currentDate = row.find('.mpei-galaktika-lessons-grid-date').text().trim();
      return;
    }

    const date = row.find('.mpei-galaktika-lessons-grid-date').text().trim() || currentDate;
    const time = row.find('.mpei-galaktika-lessons-grid-time').text().trim();
    const name = row.find('.mpei-galaktika-lessons-grid-name').text().trim();
    const type = row.find('.mpei-galaktika-lessons-grid-type').text().trim();
    const room = row.find('.mpei-galaktika-lessons-grid-room').text().trim();
    const pers = row.find('.mpei-galaktika-lessons-grid-pers').text().trim();

    const result = {
      date: date,
      time: time,
      name: name,
      type: type,
      room: room,
      pers: pers
    }

    lessons.push(result);
  })
}

async function run() {
  await translateGroup(groupId)
  await parseSite();
  console.log(lessons);
}

run();