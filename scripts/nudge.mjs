// Sends at most one daily notification, at the time chosen in the app, and only if today's play isn't done yet.
// Reads two files from the user's private progress gist: the push subscription and the synced progress.
import webpush from "web-push";

const GIST_ID = process.env.GIST_ID;
const FORCE = process.env.FORCE === "true";
if (!GIST_ID) { console.log("GIST_ID secret not set; nothing to do."); process.exit(0); }

const gist = await (await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: { "Accept": "application/vnd.github+json", "User-Agent": "intersection-nudge" } })).json();
async function file(name) {
  const f = gist.files && gist.files[name]; if (!f) return null;
  const txt = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  return JSON.parse(txt);
}
const push = await file("intersection-push.json");
const prog = await file("intersection-progress.json");
if (!push || !push.enabled || !push.subscription) { console.log("Notifications are off."); process.exit(0); }

const tz = push.tz || "America/Toronto";
const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(p => [p.type, p.value]));
const today = `${parts.year}-${parts.month}-${parts.day}`, hour = +parts.hour;
if (!FORCE && hour !== +push.hour) { console.log(`Local hour ${hour}, target ${push.hour}. Not time yet.`); process.exit(0); }
const log = (prog && prog.log) || {};
if (!FORCE && log[today]) { console.log("Already played today. Staying quiet."); process.exit(0); }

// Streak as of yesterday (today isn't done yet)
let streak = 0; { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); while (log[d.toISOString().slice(0, 10)]) { streak++; d.setUTCDate(d.getUTCDate() - 1); } }
const next = (prog && prog.nextUp) || { title: "today's play", skill: "your skills", tip: "" };

const doy = Math.floor((Date.parse(today) - Date.parse(today.slice(0, 4) + "-01-01")) / 864e5);
const pick = arr => arr[doy % arr.length];
const fill = s => s.replaceAll("{play}", next.title).replaceAll("{skill}", next.skill).replaceAll("{streak}", String(streak)).replaceAll("{days}", streak === 1 ? "1 day" : streak + " days");

let title, body;
if (streak >= 3) {
  title = fill(pick(["🔥 {days} and counting", "🔥 Streak: {days}", "Don't let {days} go to waste", "{days}. Keep the chain going."]));
  body = fill(pick([
    "Today's play: {play}. Five minutes, then get on with your day.",
    "{play} is up. Your future negotiator self says thanks.",
    "One play keeps the streak alive. Today it's {play}.",
    "The intersection doesn't build itself. {play}, five minutes.",
  ]));
} else {
  title = fill(pick([
    "Today's play: {play}",
    "Five minutes. One play.",
    "Your {skill} called. It wants a rematch.",
    "Small play, big compounding.",
    "Quick one before the day gets loud",
    "Coach here 👋",
  ]));
  body = next.tip ? fill(next.tip) : fill("{play} is ready when you are. About five minutes.");
  if (title.startsWith("Today's play")) body = next.tip || "About five minutes. Tap to start.";
}

console.log(`Composed (streak ${streak}): ${title} | ${body}`);
webpush.setVapidDetails("mailto:noreply@users.noreply.github.com", push.vapidPublic, push.vapidPrivate);
try {
  await webpush.sendNotification(push.subscription, JSON.stringify({ title, body, url: "./" }), { TTL: 6 * 3600, urgency: "normal" });
  console.log("Sent:", title, "|", body);
} catch (e) {
  console.log("Push failed:", e.statusCode, e.body || e.message);
  if (e.statusCode === 404 || e.statusCode === 410) console.log("Subscription expired. Turn notifications off and on again in the app.");
}
