package app.geniusfiles.mobile

import android.graphics.Bitmap
import android.opengl.GLES20
import android.opengl.GLUtils
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * Passes GL des calques (étape 7), exécutées après le rendu de l'image
 * vidéo et avant `swapBuffers`, donc dans le même contexte EGL que
 * l'encodeur.
 *
 *  1. `drawEffects` : le contenu déjà rendu est recopié dans une texture,
 *     puis les zones demandées sont redessinées floutées ou pixellisées.
 *     C'est la seule façon d'altérer réellement les pixels de la vidéo.
 *  2. `drawOverlay` : la texture des calques peints (texte, image, dessin)
 *     est composée par-dessus, avec transparence.
 */

private const val OVERLAY_VS = """
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vUv;
void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vUv = aTexCoord;
}
"""

private const val OVERLAY_FS = """
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTexture;
void main() {
    gl_FragColor = texture2D(uTexture, vUv);
}
"""

private const val EFFECT_FS = """
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform vec2 uTexel;
uniform float uMosaic;
uniform float uBlock;
uniform float uRadius;
void main() {
    if (uMosaic > 0.5) {
        vec2 uv = (floor(vUv / uBlock) + 0.5) * uBlock;
        gl_FragColor = texture2D(uTexture, uv);
    } else {
        vec4 sum = vec4(0.0);
        for (int i = -2; i <= 2; i++) {
            for (int j = -2; j <= 2; j++) {
                sum += texture2D(
                    uTexture,
                    vUv + vec2(float(i), float(j)) * uRadius * uTexel
                );
            }
        }
        gl_FragColor = sum / 25.0;
    }
}
"""

class GlOverlayRenderer {
    private var overlayProgram = 0
    private var effectProgram = 0
    private var overlayTexture = 0
    private var copyTexture = 0
    private var copyW = 0
    private var copyH = 0
    private var uploadedBitmap: Bitmap? = null

    private val quad: FloatBuffer = ByteBuffer.allocateDirect(16 * 4)
        .order(ByteOrder.nativeOrder()).asFloatBuffer()
    private val uv: FloatBuffer = ByteBuffer.allocateDirect(16 * 4)
        .order(ByteOrder.nativeOrder()).asFloatBuffer()

    fun setup() {
        overlayProgram = program(OVERLAY_VS, OVERLAY_FS)
        effectProgram = program(OVERLAY_VS, EFFECT_FS)
        val ids = IntArray(2)
        GLES20.glGenTextures(2, ids, 0)
        overlayTexture = ids[0]
        copyTexture = ids[1]
        for (t in ids) {
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        }
    }

    /** Flou / mosaïque : recopie du rendu courant, puis redessin des zones. */
    fun drawEffects(width: Int, height: Int, regions: List<EffectRegion>) {
        if (regions.isEmpty()) return
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, copyTexture)
        if (copyW != width || copyH != height) {
            GLES20.glCopyTexImage2D(
                GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, 0, 0, width, height, 0
            )
            copyW = width
            copyH = height
        } else {
            GLES20.glCopyTexSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, 0, 0, width, height)
        }

        GLES20.glDisable(GLES20.GL_BLEND)
        GLES20.glUseProgram(effectProgram)
        val aPos = GLES20.glGetAttribLocation(effectProgram, "aPosition")
        val aUv = GLES20.glGetAttribLocation(effectProgram, "aTexCoord")
        GLES20.glUniform1i(GLES20.glGetUniformLocation(effectProgram, "uTexture"), 0)
        GLES20.glUniform2f(
            GLES20.glGetUniformLocation(effectProgram, "uTexel"),
            1f / width.coerceAtLeast(1), 1f / height.coerceAtLeast(1)
        )
        val uMosaic = GLES20.glGetUniformLocation(effectProgram, "uMosaic")
        val uBlock = GLES20.glGetUniformLocation(effectProgram, "uBlock")
        val uRadius = GLES20.glGetUniformLocation(effectProgram, "uRadius")
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, copyTexture)

        for (r in regions) {
            fill(r.x, r.y, r.w, r.h)
            GLES20.glUniform1f(uMosaic, if (r.mosaic) 1f else 0f)
            GLES20.glUniform1f(uBlock, (0.004f + r.strength * 0.05f).coerceAtLeast(0.002f))
            GLES20.glUniform1f(uRadius, 1f + r.strength * 12f)
            GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, quad)
            GLES20.glEnableVertexAttribArray(aPos)
            GLES20.glVertexAttribPointer(aUv, 2, GLES20.GL_FLOAT, false, 0, uv)
            GLES20.glEnableVertexAttribArray(aUv)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GLES20.glDisableVertexAttribArray(aPos)
            GLES20.glDisableVertexAttribArray(aUv)
        }
    }

    /** Surimpression des calques peints, en transparence normale. */
    fun drawOverlay(bitmap: Bitmap?) {
        if (bitmap == null || bitmap.isRecycled) return
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, overlayTexture)
        if (uploadedBitmap !== bitmap) {
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
            uploadedBitmap = bitmap
        } else {
            GLUtils.texSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, bitmap)
        }

        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glUseProgram(overlayProgram)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(overlayProgram, "uTexture"), 0)
        val aPos = GLES20.glGetAttribLocation(overlayProgram, "aPosition")
        val aUv = GLES20.glGetAttribLocation(overlayProgram, "aTexCoord")
        // Le bitmap a son origine en haut à gauche : on retourne l'axe V.
        fillFlipped()
        GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, quad)
        GLES20.glEnableVertexAttribArray(aPos)
        GLES20.glVertexAttribPointer(aUv, 2, GLES20.GL_FLOAT, false, 0, uv)
        GLES20.glEnableVertexAttribArray(aUv)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(aPos)
        GLES20.glDisableVertexAttribArray(aUv)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    /** Quad couvrant une zone normalisée, texturé par cette même zone. */
    private fun fill(x: Float, y: Float, w: Float, h: Float) {
        val x0 = x * 2f - 1f
        val x1 = (x + w) * 2f - 1f
        val y0 = y * 2f - 1f
        val y1 = (y + h) * 2f - 1f
        quad.clear()
        quad.put(floatArrayOf(x0, y0, x1, y0, x0, y1, x1, y1))
        quad.position(0)
        uv.clear()
        uv.put(floatArrayOf(x, y, x + w, y, x, y + h, x + w, y + h))
        uv.position(0)
    }

    private fun fillFlipped() {
        quad.clear()
        quad.put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
        quad.position(0)
        uv.clear()
        uv.put(floatArrayOf(0f, 1f, 1f, 1f, 0f, 0f, 1f, 0f))
        uv.position(0)
    }

    fun release() {
        if (overlayProgram != 0) GLES20.glDeleteProgram(overlayProgram)
        if (effectProgram != 0) GLES20.glDeleteProgram(effectProgram)
        val ids = intArrayOf(overlayTexture, copyTexture)
        GLES20.glDeleteTextures(2, ids, 0)
        overlayProgram = 0
        effectProgram = 0
        uploadedBitmap = null
    }

    private fun program(vsSource: String, fsSource: String): Int {
        val vs = compile(GLES20.GL_VERTEX_SHADER, vsSource)
        val fs = compile(GLES20.GL_FRAGMENT_SHADER, fsSource)
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, vs)
        GLES20.glAttachShader(p, fs)
        GLES20.glLinkProgram(p)
        val status = IntArray(1)
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, status, 0)
        check(status[0] == GLES20.GL_TRUE) { "Édition de liens GL impossible (calques)" }
        GLES20.glDeleteShader(vs)
        GLES20.glDeleteShader(fs)
        return p
    }

    private fun compile(type: Int, source: String): Int {
        val id = GLES20.glCreateShader(type)
        GLES20.glShaderSource(id, source)
        GLES20.glCompileShader(id)
        val status = IntArray(1)
        GLES20.glGetShaderiv(id, GLES20.GL_COMPILE_STATUS, status, 0)
        check(status[0] == GLES20.GL_TRUE) { "Compilation du shader de calque impossible" }
        return id
    }
}
