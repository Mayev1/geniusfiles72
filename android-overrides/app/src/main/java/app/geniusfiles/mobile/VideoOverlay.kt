package app.geniusfiles.mobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface

/**
 * Composition des calques de l'étape 7.
 *
 * Deux natures bien distinctes, et c'est volontaire :
 *
 *  - Les calques **peints** (texte, image, dessin) sont dessinés sur un
 *    bitmap de la taille exacte de l'image de sortie, puis envoyés au GPU
 *    comme une texture unique composée par-dessus la vidéo. Le bitmap n'est
 *    reconstruit que lorsque l'ensemble des calques visibles change : une
 *    vidéo avec trois textes ne coûte donc pas un dessin par image.
 *  - Les calques **d'effet** (flou, mosaïque) ne peuvent pas être peints :
 *    ils transforment les pixels de la vidéo. Ils sont donc appliqués dans
 *    le shader, avant la surimpression (`GlOverlayRenderer.drawEffects`).
 *
 * Les coordonnées reçues sont normalisées dans l'image de sortie, donc
 * identiques à celles de l'aperçu de l'application.
 */

/** Trait de dessin : points normalisés aplatis (x0,y0,x1,y1…). */
class OverlayStroke(val points: FloatArray, val color: Int, val width: Float)

/** Un calque, toutes natures confondues. */
data class OverlayLayer(
    val kind: String,
    val startUs: Long,
    val endUs: Long,
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val rotation: Float = 0f,
    val opacity: Float = 1f,
    // texte
    val text: String = "",
    val textColor: Int = Color.WHITE,
    val background: Int = Color.TRANSPARENT,
    val fontSize: Float = 0.09f,
    val bold: Boolean = true,
    val align: String = "center",
    // image
    val path: String = "",
    // dessin
    val strokes: List<OverlayStroke> = emptyList(),
    // effet
    val mode: String = "blur",
    val strength: Float = 0.6f,
) {
    fun visibleAt(timeUs: Long): Boolean = timeUs >= startUs && timeUs < endUs
}

/** Zone d'effet transmise au shader, en coordonnées de texture (0..1). */
data class EffectRegion(
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val mosaic: Boolean,
    val strength: Float,
)

class OverlayCompositor(
    private val layers: List<OverlayLayer>,
    private val outW: Int,
    private val outH: Int,
) {
    private val painted = layers.filter { it.kind != "effect" }
    private val effects = layers.filter { it.kind == "effect" }

    private val images = HashMap<String, Bitmap?>()
    private var canvasBitmap: Bitmap? = null
    private var cacheKey: String? = null

    val hasPainted: Boolean get() = painted.isNotEmpty()
    val hasEffects: Boolean get() = effects.isNotEmpty()
    val isEmpty: Boolean get() = layers.isEmpty()

    /** Zones d'effet actives à cet instant, en coordonnées GL (origine en bas). */
    fun effectsAt(timeUs: Long): List<EffectRegion> {
        if (effects.isEmpty()) return emptyList()
        val out = ArrayList<EffectRegion>(effects.size)
        for (l in effects) {
            if (!l.visibleAt(timeUs)) continue
            val w = l.w.coerceIn(0.001f, 2f)
            val h = l.h.coerceIn(0.001f, 2f)
            val x = l.x.coerceIn(-1f, 1f)
            // L'axe vertical du calque descend, celui du GL monte.
            val glY = 1f - (l.y + h)
            out.add(
                EffectRegion(
                    x = x, y = glY, w = w, h = h,
                    mosaic = l.mode == "mosaic",
                    strength = l.strength.coerceIn(0f, 1f),
                )
            )
        }
        return out
    }

    /**
     * Bitmap des surimpressions à cet instant, ou `null` s'il n'y a rien à
     * dessiner. Le bitmap rendu appartient au compositeur : il ne doit pas
     * être recyclé par l'appelant.
     */
    fun paintedAt(timeUs: Long): Bitmap? {
        if (painted.isEmpty()) return null
        val active = painted.filter { it.visibleAt(timeUs) }
        if (active.isEmpty()) {
            cacheKey = ""
            return null
        }
        val key = active.joinToString("|") { it.hashCode().toString() }
        if (key == cacheKey) return canvasBitmap

        val bmp = canvasBitmap ?: Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
            .also { canvasBitmap = it }
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        for (l in active) {
            canvas.save()
            if (l.rotation != 0f) {
                canvas.rotate(
                    l.rotation,
                    (l.x + l.w / 2f) * outW,
                    (l.y + l.h / 2f) * outH,
                )
            }
            when (l.kind) {
                "text" -> drawText(canvas, l)
                "image" -> drawImage(canvas, l)
                "draw" -> drawStrokes(canvas, l)
            }
            canvas.restore()
        }
        cacheKey = key
        return bmp
    }

    private fun alphaOf(l: OverlayLayer) = (l.opacity.coerceIn(0f, 1f) * 255).toInt()

    private fun drawText(canvas: Canvas, l: OverlayLayer) {
        if (l.text.isBlank()) return
        val rect = RectF(l.x * outW, l.y * outH, (l.x + l.w) * outW, (l.y + l.h) * outH)
        if (Color.alpha(l.background) > 0) {
            val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = l.background
                alpha = (Color.alpha(l.background) * l.opacity).toInt().coerceIn(0, 255)
            }
            canvas.drawRect(rect, bg)
        }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = l.textColor
            alpha = alphaOf(l)
            textSize = (l.fontSize.coerceIn(0.01f, 0.5f) * outH)
            typeface = Typeface.create(Typeface.DEFAULT, if (l.bold) Typeface.BOLD else Typeface.NORMAL)
            textAlign = when (l.align) {
                "left" -> Paint.Align.LEFT
                "right" -> Paint.Align.RIGHT
                else -> Paint.Align.CENTER
            }
        }
        val lines = l.text.split("\n")
        val lineHeight = paint.textSize * 1.15f
        val totalHeight = lineHeight * lines.size
        var baseline = rect.centerY() - totalHeight / 2f - paint.ascent() * 0.5f + lineHeight * 0.15f
        val px = when (paint.textAlign) {
            Paint.Align.LEFT -> rect.left + rect.width() * 0.02f
            Paint.Align.RIGHT -> rect.right - rect.width() * 0.02f
            else -> rect.centerX()
        }
        for (line in lines) {
            canvas.drawText(line, px, baseline, paint)
            baseline += lineHeight
        }
    }

    private fun drawImage(canvas: Canvas, l: OverlayLayer) {
        val bmp = images.getOrPut(l.path) { decode(l.path) } ?: return
        val rect = RectF(l.x * outW, l.y * outH, (l.x + l.w) * outW, (l.y + l.h) * outH)
        // Ajustement « contenir » : l'image garde ses proportions, comme
        // dans l'aperçu (object-contain).
        val srcRatio = bmp.width.toFloat() / bmp.height.toFloat()
        val dstRatio = rect.width() / rect.height().coerceAtLeast(1f)
        var w = rect.width()
        var h = rect.height()
        if (srcRatio > dstRatio) h = w / srcRatio else w = h * srcRatio
        val dst = RectF(
            rect.centerX() - w / 2f, rect.centerY() - h / 2f,
            rect.centerX() + w / 2f, rect.centerY() + h / 2f,
        )
        val paint = Paint(Paint.FILTER_BITMAP_FLAG).apply { alpha = alphaOf(l) }
        canvas.drawBitmap(bmp, Rect(0, 0, bmp.width, bmp.height), dst, paint)
    }

    private fun drawStrokes(canvas: Canvas, l: OverlayLayer) {
        if (l.strokes.isEmpty()) return
        for (s in l.strokes) {
            if (s.points.size < 4) continue
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                color = s.color
                alpha = alphaOf(l)
                strokeWidth = (s.width * outH).coerceAtLeast(1f)
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
            }
            val path = Path()
            path.moveTo(s.points[0] * outW, s.points[1] * outH)
            var i = 2
            while (i + 1 < s.points.size) {
                path.lineTo(s.points[i] * outW, s.points[i + 1] * outH)
                i += 2
            }
            canvas.drawPath(path, paint)
        }
    }

    private fun decode(path: String): Bitmap? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        var sample = 1
        // Inutile de charger une photo de 12 Mpx pour la poser dans un coin.
        while (bounds.outWidth / sample > outW * 2 && bounds.outHeight / sample > outH * 2) {
            sample *= 2
        }
        BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
    } catch (_: Throwable) {
        null
    }

    fun release() {
        for (b in images.values) { try { b?.recycle() } catch (_: Throwable) {} }
        images.clear()
        try { canvasBitmap?.recycle() } catch (_: Throwable) {}
        canvasBitmap = null
    }
}
