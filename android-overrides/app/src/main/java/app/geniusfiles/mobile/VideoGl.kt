package app.geniusfiles.mobile

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.Matrix
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * Socle OpenGL du pipeline d'export vidéo.
 *
 * Le décodeur écrit ses images dans une `SurfaceTexture` (texture externe),
 * un shader les redessine dans la surface d'entrée de l'encodeur. Ce shader
 * porte désormais **toutes** les transformations d'image : recadrage,
 * rotation, netteté et réglages colorimétriques. L'aperçu de l'application
 * exécute exactement la même formule en WebGL, donc ce qui est vu à l'écran
 * est ce qui est écrit dans le fichier.
 */

private const val VERTEX_SHADER = """
attribute vec4 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uTexMatrix;
uniform mat4 uRotation;
uniform vec4 uCrop;      // x, y, largeur, hauteur (normalisés)
uniform vec2 uTexel;     // 1 / dimensions source
varying vec2 vTexCoord;
varying vec2 vStepX;
varying vec2 vStepY;
void main() {
    gl_Position = uRotation * aPosition;
    vec2 src = uCrop.xy + aTexCoord * uCrop.zw;
    vTexCoord = (uTexMatrix * vec4(src, 0.0, 1.0)).xy;
    vStepX = (uTexMatrix * vec4(uTexel.x, 0.0, 0.0, 0.0)).xy;
    vStepY = (uTexMatrix * vec4(0.0, uTexel.y, 0.0, 0.0)).xy;
}
"""

/**
 * Réglages appliqués dans l'ordre : netteté (masque flou), exposition,
 * luminosité, contraste, température / teinte, saturation. Toutes les
 * valeurs neutres valent 0 : un réglage non touché ne modifie donc
 * strictement rien au signal.
 */
private const val FRAGMENT_SHADER = """
#extension GL_OES_EGL_image_external : require
precision mediump float;
varying vec2 vTexCoord;
varying vec2 vStepX;
varying vec2 vStepY;
uniform samplerExternalOES uTexture;
uniform float uBrightness;
uniform float uContrast;
uniform float uExposure;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uSharpness;

void main() {
    vec3 c = texture2D(uTexture, vTexCoord).rgb;

    if (uSharpness != 0.0) {
        vec3 blur = texture2D(uTexture, vTexCoord + vStepX).rgb
                  + texture2D(uTexture, vTexCoord - vStepX).rgb
                  + texture2D(uTexture, vTexCoord + vStepY).rgb
                  + texture2D(uTexture, vTexCoord - vStepY).rgb;
        c = c + uSharpness * (c - blur * 0.25);
    }

    c *= pow(2.0, uExposure);
    c += uBrightness;
    c = (c - 0.5) * (1.0 + uContrast) + 0.5;
    c.r += uTemperature * 0.12;
    c.b -= uTemperature * 0.12;
    c.g += uTint * 0.12;
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(lum), c, 1.0 + uSaturation);

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
"""

/** Paramètres de rendu partagés entre l'aperçu et l'export. */
data class GlRenderParams(
    val cropX: Float = 0f,
    val cropY: Float = 0f,
    val cropW: Float = 1f,
    val cropH: Float = 1f,
    /** Rotation appliquée aux pixels : 0, 90, 180 ou 270 degrés. */
    val rotation: Int = 0,
    val brightness: Float = 0f,
    val contrast: Float = 0f,
    val exposure: Float = 0f,
    val saturation: Float = 0f,
    val temperature: Float = 0f,
    val tint: Float = 0f,
    val sharpness: Float = 0f,
)

/** Contexte EGL rendu vers la Surface d'entrée de l'encodeur. */
class GlEncoderSurface(private val surface: Surface) {
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var eglSurface: EGLSurface = EGL14.EGL_NO_SURFACE

    init {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        check(display != EGL14.EGL_NO_DISPLAY) { "EGL display indisponible" }
        val version = IntArray(2)
        check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize a échoué" }

        val attribs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGLExt.EGL_RECORDABLE_ANDROID, 1,
            EGL14.EGL_NONE
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        check(EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, count, 0) && count[0] > 0) {
            "Aucune configuration EGL compatible"
        }
        context = EGL14.eglCreateContext(
            display, configs[0], EGL14.EGL_NO_CONTEXT,
            intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0
        )
        check(context != EGL14.EGL_NO_CONTEXT) { "Contexte EGL impossible" }
        eglSurface = EGL14.eglCreateWindowSurface(
            display, configs[0], surface, intArrayOf(EGL14.EGL_NONE), 0
        )
        check(eglSurface != EGL14.EGL_NO_SURFACE) { "Surface EGL impossible" }
    }

    fun makeCurrent() {
        EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)
    }

    fun setPresentationTime(nsec: Long) {
        EGLExt.eglPresentationTimeANDROID(display, eglSurface, nsec)
    }

    fun swapBuffers(): Boolean = EGL14.eglSwapBuffers(display, eglSurface)

    fun release() {
        if (display != EGL14.EGL_NO_DISPLAY) {
            EGL14.eglMakeCurrent(
                display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT
            )
            EGL14.eglDestroySurface(display, eglSurface)
            EGL14.eglDestroyContext(display, context)
            EGL14.eglReleaseThread()
            EGL14.eglTerminate(display)
        }
        display = EGL14.EGL_NO_DISPLAY
        context = EGL14.EGL_NO_CONTEXT
        eglSurface = EGL14.EGL_NO_SURFACE
        surface.release()
    }
}

/**
 * Texture externe recevant les images du décodeur, et le shader qui les
 * transforme dans le contexte EGL courant.
 */
class GlFrameRenderer : SurfaceTexture.OnFrameAvailableListener {
    private val lock = Object()
    private var frameAvailable = false

    private var program = 0
    private var textureId = 0
    private var aPosition = 0
    private var aTexCoord = 0
    private var uTexMatrix = 0
    private var uRotation = 0
    private var uCrop = 0
    private var uTexel = 0
    private val uniforms = HashMap<String, Int>()

    private val texMatrix = FloatArray(16)
    private val rotMatrix = FloatArray(16)
    private var params = GlRenderParams()
    private var sourceWidth = 1
    private var sourceHeight = 1

    private val vertices: FloatBuffer = ByteBuffer
        .allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        .put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)).also { it.position(0) }
    private val texCoords: FloatBuffer = ByteBuffer
        .allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        .put(floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)).also { it.position(0) }

    lateinit var surfaceTexture: SurfaceTexture
        private set
    lateinit var surface: Surface
        private set

    /** À appeler avec le contexte EGL de l'encodeur déjà courant. */
    fun setup() {
        program = buildProgram()
        aPosition = GLES20.glGetAttribLocation(program, "aPosition")
        aTexCoord = GLES20.glGetAttribLocation(program, "aTexCoord")
        uTexMatrix = GLES20.glGetUniformLocation(program, "uTexMatrix")
        uRotation = GLES20.glGetUniformLocation(program, "uRotation")
        uCrop = GLES20.glGetUniformLocation(program, "uCrop")
        uTexel = GLES20.glGetUniformLocation(program, "uTexel")
        for (name in listOf(
            "uBrightness", "uContrast", "uExposure",
            "uSaturation", "uTemperature", "uTint", "uSharpness"
        )) {
            uniforms[name] = GLES20.glGetUniformLocation(program, name)
        }

        val ids = IntArray(1)
        GLES20.glGenTextures(1, ids, 0)
        textureId = ids[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE
        )

        Matrix.setIdentityM(texMatrix, 0)
        Matrix.setIdentityM(rotMatrix, 0)
        surfaceTexture = SurfaceTexture(textureId)
        surfaceTexture.setOnFrameAvailableListener(this)
        surface = Surface(surfaceTexture)
    }

    /** Définit recadrage, rotation et réglages d'image pour l'export. */
    fun configure(params: GlRenderParams, sourceWidth: Int, sourceHeight: Int) {
        this.params = params
        this.sourceWidth = sourceWidth.coerceAtLeast(1)
        this.sourceHeight = sourceHeight.coerceAtLeast(1)
        Matrix.setIdentityM(rotMatrix, 0)
        // La rotation tourne le quad dans l'espace normalisé : la surface de
        // sortie a déjà ses dimensions permutées pour 90 / 270.
        Matrix.rotateM(rotMatrix, 0, -params.rotation.toFloat(), 0f, 0f, 1f)
    }

    override fun onFrameAvailable(st: SurfaceTexture) {
        synchronized(lock) {
            frameAvailable = true
            lock.notifyAll()
        }
    }

    /** Attend l'image décodée ; `false` si le décodeur n'en produit plus. */
    fun awaitFrame(timeoutMs: Long = 2500): Boolean {
        synchronized(lock) {
            val deadline = System.currentTimeMillis() + timeoutMs
            while (!frameAvailable) {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining <= 0) return false
                try {
                    lock.wait(remaining)
                } catch (e: InterruptedException) {
                    return false
                }
            }
            frameAvailable = false
        }
        surfaceTexture.updateTexImage()
        surfaceTexture.getTransformMatrix(texMatrix)
        return true
    }

    fun draw(width: Int, height: Int) {
        GLES20.glViewport(0, 0, width, height)
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glVertexAttribPointer(aPosition, 2, GLES20.GL_FLOAT, false, 0, vertices)
        GLES20.glEnableVertexAttribArray(aPosition)
        GLES20.glVertexAttribPointer(aTexCoord, 2, GLES20.GL_FLOAT, false, 0, texCoords)
        GLES20.glEnableVertexAttribArray(aTexCoord)
        GLES20.glUniformMatrix4fv(uTexMatrix, 1, false, texMatrix, 0)
        GLES20.glUniformMatrix4fv(uRotation, 1, false, rotMatrix, 0)
        GLES20.glUniform4f(uCrop, params.cropX, params.cropY, params.cropW, params.cropH)
        GLES20.glUniform2f(uTexel, 1f / sourceWidth, 1f / sourceHeight)
        uniforms["uBrightness"]?.let { GLES20.glUniform1f(it, params.brightness) }
        uniforms["uContrast"]?.let { GLES20.glUniform1f(it, params.contrast) }
        uniforms["uExposure"]?.let { GLES20.glUniform1f(it, params.exposure) }
        uniforms["uSaturation"]?.let { GLES20.glUniform1f(it, params.saturation) }
        uniforms["uTemperature"]?.let { GLES20.glUniform1f(it, params.temperature) }
        uniforms["uTint"]?.let { GLES20.glUniform1f(it, params.tint) }
        uniforms["uSharpness"]?.let { GLES20.glUniform1f(it, params.sharpness) }
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(aPosition)
        GLES20.glDisableVertexAttribArray(aTexCoord)
    }

    fun release() {
        try { surface.release() } catch (_: Throwable) {}
        try { surfaceTexture.release() } catch (_: Throwable) {}
        if (program != 0) GLES20.glDeleteProgram(program)
        program = 0
    }

    private fun buildProgram(): Int {
        val vs = compile(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
        val fs = compile(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, vs)
        GLES20.glAttachShader(p, fs)
        GLES20.glLinkProgram(p)
        val status = IntArray(1)
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, status, 0)
        check(status[0] == GLES20.GL_TRUE) { "Édition de liens GL impossible" }
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
        check(status[0] == GLES20.GL_TRUE) { "Compilation du shader impossible" }
        return id
    }
}
