#!/usr/bin/env node
/**
 * Ставит (или снимает) задачу Планировщика Windows «DotaMate - ежедневное обновление».
 *
 * Как задача решает «раз в сутки, когда компьютер включён»:
 *  - запуск каждый день в 10:00 и повтор каждые 2 часа до конца суток;
 *  - если компьютер был выключен — запуск сразу после включения (StartWhenAvailable)
 *    и при входе в Windows;
 *  - сам tools/daily-update.js с флагом --auto выходит сразу, если сегодня уже было
 *    успешное обновление. Поэтому фактически работа идёт один раз в день, а при
 *    неудаче (нет интернета и т.п.) повторяется через пару часов.
 *
 * Запуск: node tools/install-daily-task.js            — поставить/обновить
 *         node tools/install-daily-task.js --remove   — снять
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TASK = 'DotaMate - ежедневное обновление';
const ROOT = path.join(__dirname, '..');

if (process.platform !== 'win32') { console.error('Нужен Windows.'); process.exit(1); }

if (process.argv.includes('--remove')) {
  try { execFileSync('schtasks', ['/Delete', '/TN', TASK, '/F'], { stdio: 'inherit' }); }
  catch { console.error('Задача не найдена или не снята.'); process.exit(1); }
  process.exit(0);
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const user = `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`;
const d = new Date(); d.setHours(10, 0, 0, 0);
const start = d.toISOString().slice(0, 10) + 'T10:00:00';
// Окно сворачивается в панель задач: процесс идёт час-два, мешать не должен.
const args = `/c start "DotaMate update" /min "${process.execPath}" tools\\daily-update.js --auto`;

const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Сбор матчей, META, способностей и выкладка dotamate.ru раз в сутки.</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${start}</StartBoundary>
      <Repetition><Interval>PT2H</Interval><Duration>PT14H</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger><UserId>${esc(user)}</UserId><Delay>PT5M</Delay></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT6H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>cmd.exe</Command><Arguments>${esc(args)}</Arguments><WorkingDirectory>${esc(ROOT)}</WorkingDirectory></Exec>
  </Actions>
</Task>`;

const tmp = path.join(os.tmpdir(), 'dotamate-task.xml');
fs.writeFileSync(tmp, '﻿' + xml, 'utf16le');
try {
  execFileSync('schtasks', ['/Create', '/TN', TASK, '/XML', tmp, '/F'], { stdio: 'inherit' });
} catch {
  console.error('Не удалось создать задачу. Попробуйте запустить файл от имени администратора.');
  process.exit(1);
} finally { fs.unlinkSync(tmp); }
console.log(`\nЗадача «${TASK}» поставлена.`);
console.log('Сайт будет обновляться раз в сутки, когда компьютер включён. Журнал — папка logs.');
