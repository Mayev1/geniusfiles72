#!/usr/bin/env node
/**
 * generate-app-icons.mjs
 *
 * Génère TOUTES les ressources graphiques Android de GeniusFiles à partir
 * d'un seul master : `public/brand/geniusfiles-logo.png`.
 *
 * Ce master est un PNG 1024×1024 **détouré** (fond transparent) et
 * **recadré au plus juste** sur la marque : une plaque à coins arrondis
 * (corps clair ≈ #EDEEF2, onglet bleu, visage sombre).
 *
 * CAUSE RACINE de l'effet « petite image posée sur un carré noir » :
 * Android n'affiche que la région centrale 72dp d'un calque adaptatif de
 * 108dp (ratio 0.667). L'ancien premier plan dessinait la marque à 0.50
 * du canvas — soit ~54dp sur les 72dp visibles (75 %) — sur un fond
 * graphite #191919. Résultat : marque visuellement réduite d'un quart,
 * encadrée d'un liseré sombre, là où les applications premium (TempoKey)
 * sont *full-bleed*.
 *
 * CORRECTIF : la marque est dessinée à 0.62 du canvas → elle remplit
 * la fenêtre visible de 72dp (léger retrait pour que l'onglet du dossier
 * ne soit jamais rogné par un masque circulaire), et le calque de fond reprend la couleur du corps du
 * logo (#EDEEF2). Les coins rognés par le masque du lanceur (cercle,
 * squircle, arrondi, carré) se fondent donc dans la marque : plus aucun
 * bord noir, aucune marge excessive, proportions d'origine intactes.
 *
 * Ressources produites :
 *   resources/icon.png            → icône legacy (API < 26), 1024², fond plaque
 *   resources/icon-foreground.png → premier plan adaptatif, transparent
 *   resources/icon-background.png → arrière-plan adaptatif, couleur plaque
 *   resources/splash.png(-dark)   → splash Capacitor (API < 31)
 *   drawable-nodpi/splash_icon_foreground.png → icône du SplashScreen API 31+
 *
 * Les ratios respectent les keylines Material :
 *   - adaptatif full-bleed : fenêtre visible = 72/108 = 0.667 → marque à
 *     0.62 (léger retrait pour préserver l'onglet du dossier), fond plein
 *     de la couleur de la plaque (aucun contraste sur les
 *     coins rognés, quel que soit le lanceur).
 *   - SplashScreen API 31+ : la marque doit tenir dans les 2/3 intérieurs
 *     du cercle de 288dp → 0.62 (≈ 179dp sur 192dp utiles).
 *
 * Idempotent — sûr à relancer à chaque build CI. Doit tourner APRÈS
 * `npx cap add android` et AVANT `apply-android-overrides.mjs`.
 */
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(process.cwd());
const RESOURCES = join(ROOT, "resources");
const ANDROID = join(ROOT, "android");

/**
 * Fond de marque — identique à `values/colors.xml` (splash_background),
 * à `capacitor.config.ts` et à la variable CSS `--background` sombre.
 */
const BG = { r: 0x19, g: 0x19, b: 0x19, alpha: 1 };

/**
 * Couleur du corps de la plaque du logo, échantillonnée sur le master.
 * Utilisée comme calque de fond adaptatif ET comme fond de l'icône legacy :
 * les zones rognées par les masques constructeurs deviennent invisibles.
 */
const PLATE = { r: 0xed, g: 0xee, b: 0xf2, alpha: 1 };

/** Fond clair officiel de l'application (`--background` en thème clair). */
const PLATE_LIGHT = { r: 0xf5, g: 0xf6, b: 0xf8, alpha: 1 };

if (!existsSync(ANDROID)) {
  console.error("✗ android/ folder does not exist. Run `npx cap add android` first.");
  process.exit(1);
}

const LOGO_SRC = join(ROOT, "public", "brand", "geniusfiles-logo.png");
if (!existsSync(LOGO_SRC)) {
  console.error(`✗ Missing brand logo at ${LOGO_SRC}.`);
  process.exit(1);
}
console.log(`→ Using brand logo ${LOGO_SRC}`);

/**
 * Illustration officielle du splash (robot GeniusFiles), PNG détouré.
 * Elle n'est plus composée dans les ressources natives : le splash système
 * ne peint que le fond du thème, l'illustration unique étant rendue par
 * l'overlay web (`SplashOverlay`). On vérifie néanmoins sa présence : elle
 * doit être embarquée dans l'APK (`public/brand/`).
 */
const SPLASH_SRC = join(ROOT, "public", "brand", "geniusfiles-splash.png");
if (!existsSync(SPLASH_SRC)) {
  console.error(`✗ Missing splash artwork at ${SPLASH_SRC}.`);
  process.exit(1);
}

/**
 * Déclinaisons 1:1 de l'illustration pour l'overlay web (178dp × densité).
 * Elles évitent tout rééchantillonnage par la WebView : la netteté du
 * splash applicatif est alors identique à celle du splash système.
 * Elles sont versionnées dans `public/brand/` et embarquées dans l'APK.
 */
for (const scale of [1, 2, 3, 4]) {
  const variant = join(ROOT, "public", "brand", `geniusfiles-splash-${scale}x.png`);
  if (!existsSync(variant)) {
    console.error(
      `✗ Missing splash variant ${variant}. Régénérez les déclinaisons 192×159 ×${scale} depuis le master.`,
    );
    process.exit(1);
  }
}

/**
 * Recadre le master sur ses pixels non transparents puis le re-centre dans
 * un carré. Filet de sécurité : si quelqu'un remplace le logo par une
 * version comportant des marges, les ratios ci-dessous restent exacts.
 */
async function squareMark(src) {
  const trimmed = await sharp(await readFile(src))
    .ensureAlpha()
    .trim({ threshold: 1 })
    .png()
    .toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.max(meta.width ?? 1024, meta.height ?? 1024);
  return sharp({
    create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: trimmed, gravity: "centre" }])
    .png()
    .toBuffer();
}

const markBuf = await squareMark(LOGO_SRC);

await mkdir(RESOURCES, { recursive: true });

/**
 * Compose la marque, centrée, à `ratio` du canvas, sur `background`.
 *
 * QUALITÉ : la marque n'est JAMAIS agrandie au-delà de la résolution du
 * master (`lanczos3` en réduction uniquement). Un agrandissement produirait
 * une image floue / pixellisée sur le splash système — c'est exactement ce
 * que l'on interdit ici.
 */
async function compose({ size, ratio, background, output, source = markBuf }) {
  const markSize = Math.round(size * ratio);
  const srcMeta = await sharp(source).metadata();
  const srcSide = Math.max(srcMeta.width ?? 0, srcMeta.height ?? 0);
  if (srcSide && markSize > srcSide) {
    throw new Error(
      `Agrandissement interdit : marque ${markSize}px demandée pour un master ${srcSide}px (${output}).`,
    );
  }
  const mark = await sharp(source)
    .resize(markSize, markSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(output);
  console.log(`   ✓ ${output} (${size}², marque ${Math.round(ratio * 100)}%)`);
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

console.log(`→ Composition des masters sous resources/`);
// Icône legacy (API < 26) : le lanceur masque directement cette tuile, la
// marque peut donc occuper presque tout le carré, sur le fond plaque.
await compose({ size: 1024, ratio: 1.0, background: PLATE, output: join(RESOURCES, "icon.png") });
// Premier plan adaptatif : 0.667 = EXACTEMENT la fenêtre visible 72/108 →
// la marque remplit toute la zone affichée par le lanceur (taille visuelle
// comparable aux autres applications) sans jamais être rognée. Aller au-delà
// ferait couper les bords de la plaque sur les masques circulaires.
// Le master officiel (1059²) est réduit, jamais agrandi : aucun flou.
await compose({
  size: 1024,
  ratio: 0.667,
  background: TRANSPARENT,
  output: join(RESOURCES, "icon-foreground.png"),
});
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: PLATE } })
  .png()
  .toFile(join(RESOURCES, "icon-background.png"));
console.log(`   ✓ resources/icon-background.png (fond adaptatif)`);

// ─────────────────────────────────────────────────────────────────────
// Splash Capacitor (API < 31).
//
// Le splash natif peint DÉSORMAIS l'illustration officielle, à la même
// échelle et à la même position que l'overlay web : la marque est donc
// visible dès la toute première frame du cold start (plus aucun écran de
// couleur « vide » pendant le démarrage de la WebView), et la passation
// vers l'overlay est strictement invisible (même image, même taille,
// même centre, même fond).
//
// Géométrie : Capacitor affiche ce carré en FIT_CENTER, donc le carré est
// mis à l'échelle de la plus petite dimension de l'écran. Un ratio de
// 0.5333 reproduit, sur un téléphone standard (~360dp de large), la largeur
// de 192dp imposée par le SplashScreen système d'Android 12+ — les deux
// générations affichent ainsi la marque à la même taille perçue.
// ─────────────────────────────────────────────────────────────────────
const splashMarkBuf = await squareMark(SPLASH_SRC);
const LEGACY_SPLASH_RATIO = 0.5333;
/**
 * Taille du canvas calée sur la résolution native du master : la marque
 * est composée à 1:1 (aucun agrandissement, donc aucun flou), puis
 * réduite par Android à la taille de l'écran (FIT_CENTER) — une réduction
 * reste toujours nette.
 */
const splashMarkMeta = await sharp(splashMarkBuf).metadata();
const SPLASH_MARK_SIDE = Math.max(splashMarkMeta.width ?? 802, splashMarkMeta.height ?? 802);
const LEGACY_SPLASH_SIZE = Math.round(SPLASH_MARK_SIDE / LEGACY_SPLASH_RATIO);
await compose({
  size: LEGACY_SPLASH_SIZE,
  ratio: LEGACY_SPLASH_RATIO,
  background: PLATE_LIGHT,
  output: join(RESOURCES, "splash.png"),
  source: splashMarkBuf,
});
await compose({
  size: LEGACY_SPLASH_SIZE,
  ratio: LEGACY_SPLASH_RATIO,
  background: BG,
  output: join(RESOURCES, "splash-dark.png"),
  source: splashMarkBuf,
});
console.log("   ✓ resources/splash.png + splash-dark.png (illustration officielle)");

console.log(`→ Running @capacitor/assets to generate Android resources`);
const result = spawnSync("npx", ["capacitor-assets", "generate", "--android"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.status !== 0) {
  console.error("✗ capacitor-assets generate failed");
  process.exit(result.status ?? 1);
}

// ─────────────────────────────────────────────────────────────────────
// SplashScreen Android 12+ (API 31+).
//
// Android impose son SplashScreen : `windowSplashScreenAnimatedIcon` est
// un calque adaptatif de 288dp dont seuls les 2/3 intérieurs (192dp) sont
// visibles. L'illustration officielle y est dessinée à 0.667 du canvas,
// soit 192dp de large — exactement la largeur utilisée par l'overlay
// web (`SPLASH_ART_WIDTH_PX`). La marque est donc peinte dès la première
// frame du système, puis reprise à l'identique par la WebView : une seule
// image, une seule échelle, une seule position, aucun clignotement.
//
// Le calque est émis en 1152² (4× 288dp @xxxhdpi) et l'illustration y occupe
// 0.667 du canvas — la fenêtre visible du masque adaptatif — soit 768 px,
// exactement 192dp × 4 — la plus grande taille possible SANS agrandir le master officiel (802 px) : aucun
// flou, aucune interpolation, netteté maximale à toutes les densités.
// ─────────────────────────────────────────────────────────────────────
const SPLASH_ICON_DIR = join(ANDROID, "app", "src", "main", "res", "drawable-nodpi");
await mkdir(SPLASH_ICON_DIR, { recursive: true });
await compose({
  size: 1152,
  ratio: 0.667,
  background: TRANSPARENT,
  output: join(SPLASH_ICON_DIR, "splash_icon_foreground.png"),
  source: splashMarkBuf,
});
console.log("   ✓ drawable-nodpi/splash_icon_foreground.png (illustration officielle)");

console.log("✓ Icônes + splash Android générés depuis le logo GeniusFiles.");
