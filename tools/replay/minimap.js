// Перевод координат парсера в доли миникарты (0..1), общий для сервера и страницы /live.
// Парсер (odota/parser, Clarity) отдаёт «клеточные» координаты: мир = (cell - 128) * 128.
// Границы миникарты — из файла игры dota/resource/overviews/dota.txt (репозиторий dotabuff/d2vpkr):
//   pos_x -9472, pos_y 9472, scale 18.5 на текстуру 1024 px  =>  квадрат 18944 мировых единиц.
// Отсюда: u = (cell - 54) / 148, v = (202 - cell) / 148. Центр карты (cell 128) -> 0.5.
// Проверено 02.10.2026 тепловой картой 3 матчей: фонтаны в углах, мид по диагонали, карта симметрична.
'use strict';
const MAP = { cellMin: 54, cellSpan: 148, source: 'dota/resource/overviews/dota.txt: pos_x -9472, pos_y 9472, scale 18.5' };
function cellToUV(x, y) { return [(x - MAP.cellMin) / MAP.cellSpan, (MAP.cellMin + MAP.cellSpan - y) / MAP.cellSpan]; }
if (typeof module !== 'undefined') module.exports = { MAP, cellToUV };
