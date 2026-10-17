/**
 * Blocks insults in player names (leaderboard + race). Shared by the game and
 * the server, so the server rejects them even if the client check is skipped.
 *
 * Names are normalized first (diacritics, tatweel, letter variants, spacing,
 * stretched letters) so «خ و و ل», «خـــول» or «M.a.n.y.o.o.k» still match.
 */

/** Matched anywhere inside the name (spaces and symbols removed). */
const ANYWHERE = [
  // Arabic
  "خول",
  "عرص",
  "منيوك",
  "منيك",
  "متناك",
  "شرموط",
  "قحبه",
  "لبوه",
  "كسمك",
  "كسامك",
  "كسم",
  "كسختك",
  "طيزك",
  "نيكني",
  "ديوث",
  "عاهره",
  "مخنث",
  "بضان",
  "ابنالوسخه",
  "ابنالكلب",
  "ابنالمتناكه",
  "ابنالشرموطه",
  // Franco / English
  "khawal",
  "khwal",
  "5awal",
  "5wal",
  "3ars",
  "m3rs",
  "manyok",
  "mnyok",
  "metnak",
  "mtnak",
  "sharmot",
  "kosomak",
  "ksomak",
  "kosom",
  "labwa",
  "ibnelkalb",
  "fuck",
  "fck",
  "shit",
  "bitch",
  "cunt",
  "ashole",
  "pusy",
  "whore",
  "slut",
];

/** Short words that hide inside innocent names: matched only as a whole word. */
const WHOLE_WORD = ["كس", "كسك", "زبي", "زبك", "انيك", "هنيك", "نيكك", "طيز", "زب", "نيك", "احا", "زاني", "لوطي", "عرص", "a7a", "kos", "dick", "zeby"];

/** Real names that contain a blocked word, e.g. خولة, الخولي, دخول. */
const SAFE = ["خوله", "خولي", "دخول", "مدخول"];

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalize(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[ً-ٰٟـ]/g, "") // diacritics + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/گ/g, "ك")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/(.)\1+/gu, "$1"); // stretched letters: خووول → خول
}

// Drop spaces/symbols, then squash repeats again: «خ و و ل» → خول.
const squash = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").replace(/(.)\1+/gu, "$1");

const anywhere = ANYWHERE.map((w) => squash(normalize(w)));
const wholeWord = new Set(WHOLE_WORD.map((w) => normalize(w)));
const safe = SAFE.map((w) => normalize(w));

/** True when the name contains an insult. */
export function hasBadWords(name: string): boolean {
  const n = normalize(name);
  let joined = squash(n);
  for (const s of safe) joined = joined.split(s).join("_");
  if (anywhere.some((w) => joined.includes(w))) return true;
  return n
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .some((t) => wholeWord.has(t) || wholeWord.has(t.replace(/^(ال|يا)/, "")));
}
